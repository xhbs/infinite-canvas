window.__ModuleLoader__.load({
  id: '@local/canvas-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ── 常量 ────────────────────────────────────────────────────────────────
    // 宿主路由（SPEC §2.6）：同源 POST，GET 语义放在 body 的 action 里。
    const ENDPOINT = '/api/canvas-bridge';
    const REQUEST_HEADERS = { 'content-type': 'application/json', 'x-canvas-bridge': '1' };
    const POLL_MS = 3000;
    // allow-popups-to-escape-sandbox 用于画布的第三方登录弹窗（OAuth）；页面本身仍是跨源 iframe。
    const FRAME_SANDBOX =
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
    const PLACEHOLDER = 'http://localhost:3000/canvas/xxxx';
    // 与宿主 normalizeCanvasUrl 保持同一套规则：http + localhost/127.0.0.1 + 显式端口 + /canvas/<id>。
    const CANVAS_URL_RE = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}\/canvas\/[A-Za-z0-9._~-]+\/?$/;
    const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

    const str = (value) => (typeof value === 'string' ? value : '');

    // ── 纯函数 ──────────────────────────────────────────────────────────────

    // 从 #agentUrl=...&agentToken=... 里取值（画布页自己就是这么读的）。
    function readHash(url, key) {
      const index = url.indexOf('#');
      if (index < 0) return '';
      const hash = url.slice(index + 1);
      if (!hash) return '';
      try {
        return str(new URLSearchParams(hash).get(key));
      } catch {
        return '';
      }
    }

    function isCanvasUrl(value) {
      return CANVAS_URL_RE.test(value);
    }

    // 掩码展示：64 位 hex 只露出前 4 / 后 4 位。
    function maskToken(token) {
      if (!token) return '';
      if (token.length <= 8) return '••••••••';
      return token.slice(0, 4) + '••••••••' + token.slice(-4);
    }

    function reasonOf(error, fallback) {
      if (error instanceof Error && error.message) return error.message;
      return fallback;
    }

    async function copyText(text, host) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        /* 剪贴板 API 被拒（非安全上下文/无权限）时退回选区复制 */
      }
      if (!host || typeof host.appendChild !== 'function') return false;
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'absolute';
        area.style.left = '-9999px';
        area.style.top = '0';
        area.style.opacity = '0';
        host.appendChild(area);
        area.select();
        area.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        host.removeChild(area);
        return ok;
      } catch {
        return false;
      }
    }

    // ── 宿主调用 ────────────────────────────────────────────────────────────

    async function postHost(action, payload, signal) {
      let response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: REQUEST_HEADERS,
          body: JSON.stringify({ action, ...(payload || {}) }),
          signal,
        });
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error('连不上宿主：请确认 DSH 正在运行，然后点「刷新」重试。');
      }

      const text = await response.text().catch(() => '');
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (response.status === 403) {
        throw new Error(
          '宿主拒绝了面板请求（缺少 x-canvas-bridge 头）：请确认 canvas-bridge 插件已在当前 profile 启用。',
        );
      }
      if (!data && /^\s*<(!doctype|html)/i.test(text)) {
        throw new Error(
          '宿主路由还没有实现（/api/canvas-bridge 返回了 HTML）：请确认宿主插件已启用并重启 DSH。',
        );
      }
      if (response.status === 404) {
        throw new Error(
          '宿主路由不存在（HTTP 404）：请确认 canvas-bridge 宿主插件已在当前 profile 启用，并重启 DSH。',
        );
      }
      if (!response.ok) {
        throw new Error(
          (data && (str(data.error) || str(data.message))) ||
            '宿主返回错误（HTTP ' + response.status + '）。',
        );
      }
      if (!data || typeof data !== 'object') {
        throw new Error('宿主返回了无法解析的响应，请重启 DSH 后重试。');
      }
      if (data.ok === false) {
        throw new Error(str(data.error) || '宿主拒绝了这次操作。');
      }
      // 兼容两种返回包装：直接的 state 对象，或 { ok, value | state }。
      if (data.value && typeof data.value === 'object') return data.value;
      if (data.state && typeof data.state === 'object') return data.state;
      return data;
    }

    function normalizeState(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const sessions = Array.isArray(source.sessions) ? source.sessions : [];
      const site = source.site && typeof source.site === 'object' ? source.site : null;
      const backend = source.backend && typeof source.backend === 'object' ? source.backend : null;
      return {
        bridgeUrl: str(source.bridgeUrl),
        port: typeof source.port === 'number' ? source.port : null,
        canvasUrl: str(source.canvasUrl).trim(),
        hasToken: source.hasToken === true,
        sessions,
        // ok 是布尔才算探测过；缺字段按「未知」处理，不误报站点故障。
        site: {
          ok: site && typeof site.ok === 'boolean' ? site.ok : null,
          url: site ? str(site.url) : '',
          error: site ? str(site.error) : '',
        },
        backend: {
          ok: backend && typeof backend.ok === 'boolean' ? backend.ok : null,
          error: backend ? str(backend.error) : '',
        },
      };
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    const CSS = `
.cb-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased}
.cb-root *{box-sizing:border-box}
.cb-bar{display:flex;flex:none;align-items:center;gap:8px;height:28px;padding:0 4px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap;transition:background .2s ease,border-color .2s ease}
.cb-bar-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,var(--dsw-alias-bg-layer-1));border-bottom-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-border-l1))}
.cb-stats{display:flex;flex:none;align-items:center;gap:9px;overflow:hidden}
.cb-stat{display:inline-flex;flex:none;align-items:center;gap:4px}
.cb-statvalue{color:var(--dsw-alias-label-primary);opacity:.9}
.cb-dot{width:6px;height:6px;flex:none;border-radius:999px;background:var(--dsw-alias-label-secondary);opacity:.45}
.cb-dot-ok{background:var(--dsw-alias-state-success-primary);opacity:1}
.cb-dot-bad{background:var(--dsw-alias-state-error-primary);opacity:1}
.cb-dot-idle{background:var(--dsw-alias-label-secondary);opacity:.45}
.cb-reason{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);opacity:.85}
.cb-actions{display:flex;flex:none;align-items:center;gap:2px;margin-left:auto}
.cb-act{height:20px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease}
.cb-act:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.cb-act:disabled{opacity:.45;cursor:default}
.cb-act:disabled:hover{background:none;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.cb-body{position:relative;display:flex;flex:1 1 auto;min-height:0;background:var(--dsw-alias-bg-base)}
.cb-frame{display:block;flex:1 1 auto;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-layer-1)}
.cb-center{align-items:center;justify-content:center;overflow:auto;padding:24px}
.cb-configwrap{align-items:flex-start;justify-content:center;overflow:auto;padding:32px 24px 40px}
.cb-config{width:100%;max-width:540px;padding:18px 18px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.cb-configtitle{font-size:15px;font-weight:600;letter-spacing:.1px}
.cb-configtext{margin:8px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7}
.cb-inputrow{display:flex;align-items:center;gap:8px}
.cb-input{width:100%;min-width:0;flex:1 1 auto;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.cb-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}
.cb-input:hover{border-color:var(--dsw-alias-border-l2)}
.cb-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.cb-btn{display:inline-flex;flex:none;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease}
.cb-btn:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.cb-btn:disabled{opacity:.5;cursor:default}
.cb-btnfill{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:500}
.cb-btnfill:hover{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);opacity:.9}
.cb-mini{height:22px;padding:0 8px;font-size:11px;border-radius:6px}
.cb-error{margin-top:6px;color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.6;word-break:break-word}
.cb-steps{margin:12px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.8}
.cb-steps li{margin:0}
.cb-tiny{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.65;word-break:break-all}
.cb-card{width:100%;max-width:430px;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.cb-cardtitle{font-size:14px;font-weight:600}
.cb-cardtext{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7;word-break:break-word}
.cb-cardnext{margin:12px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.7}
.cb-cardactions{display:flex;align-items:center;gap:8px;margin-top:14px}
.cb-hint{position:absolute;left:10px;bottom:10px;z-index:5;display:flex;align-items:flex-start;gap:10px;width:calc(100% - 20px);max-width:680px;padding:10px 10px 10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-border-l1));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,var(--dsw-alias-bg-layer-1));box-shadow:0 6px 20px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
.cb-hint-info{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.cb-hintbody{flex:1 1 auto;min-width:0}
.cb-hinttitle{font-size:12.5px;font-weight:600}
.cb-hinttext{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.65}
.cb-hintactions{display:flex;flex:none;align-items:center;gap:4px}
.cb-scrim{position:absolute;inset:0;z-index:20;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.cb-settings{position:absolute;top:34px;right:8px;width:min(360px,calc(100% - 16px));padding:12px 14px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
.cb-settingshead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cb-settingstitle{font-size:13px;font-weight:600}
.cb-label{display:block;margin:12px 0 5px;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.cb-settings .cb-label{margin-top:0}
.cb-kv{display:flex;align-items:center;gap:8px;margin-top:8px}
.cb-kvlabel{flex:none;width:52px;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.cb-kvvalue{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:${MONO};font-size:11.5px}
.cb-hr{height:1px;margin:12px 0 2px;background:var(--dsw-alias-border-l1)}
.cb-copied{color:var(--dsw-alias-state-success-primary)!important;border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)!important;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,var(--dsw-alias-bg-layer-2))!important}
`;

    // ── 小组件 ──────────────────────────────────────────────────────────────

    function StatusItem({ label, tone, text }) {
      return h(
        'span',
        { className: 'cb-stat', title: label + '：' + text },
        h('span', { className: 'cb-dot cb-dot-' + tone }),
        h('span', null, label),
        h('span', { className: 'cb-statvalue' }, text),
      );
    }

    function KeyRow({ label, value, action }) {
      return h(
        'div',
        { className: 'cb-kv' },
        h('span', { className: 'cb-kvlabel' }, label),
        h('span', { className: 'cb-kvvalue', title: value }, value),
        action || null,
      );
    }

    function CenterCard({ title, detail, next, children }) {
      return h(
        'div',
        { className: 'cb-body cb-center' },
        h(
          'div',
          { className: 'cb-card' },
          h('div', { className: 'cb-cardtitle' }, title),
          detail ? h('p', { className: 'cb-cardtext' }, detail) : null,
          next ? h('p', { className: 'cb-cardnext' }, next) : null,
          children ? h('div', { className: 'cb-cardactions' }, children) : null,
        ),
      );
    }

    function ConfigView({ draft, onDraft, onSave, saveError, busy, bridgeAddr, hasToken }) {
      return h(
        'div',
        { className: 'cb-body cb-configwrap' },
        h(
          'div',
          { className: 'cb-config' },
          h('div', { className: 'cb-configtitle' }, '把画布接进侧栏'),
          h(
            'p',
            { className: 'cb-configtext' },
            '粘贴 Infinite Canvas 的画布地址。保存后这里会整块内嵌这张画布，Agent 同时获得画布工具，可以直接读画布、生成与编辑节点。',
          ),
          h(
            'div',
            { className: 'cb-inputrow' },
            h('input', {
              className: 'cb-input',
              placeholder: PLACEHOLDER,
              value: draft,
              spellCheck: false,
              autoComplete: 'off',
              'aria-label': '画布地址',
              onChange: (event) => onDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSave();
                }
              },
            }),
            h(
              'button',
              { className: 'cb-btn cb-btnfill', onClick: onSave, disabled: busy },
              busy ? '保存中…' : '保存并打开',
            ),
          ),
          saveError ? h('div', { className: 'cb-error', role: 'alert' }, saveError) : null,
          h(
            'ol',
            { className: 'cb-steps' },
            h('li', null, '启动画布：本机 Go 后端 + Next.js 前端（默认 http://localhost:3000）。'),
            h('li', null, '在浏览器打开任意画布，复制地址栏里的 /canvas/<画布ID> 完整地址。'),
            h('li', null, '粘贴到上面点「保存并打开」，地址只存在本机。'),
          ),
          h(
            'div',
            { className: 'cb-tiny' },
            '桥地址：' +
              (bridgeAddr || '——') +
              (hasToken ? ' · 连接凭据已生成' : ' · 等待宿主生成凭据'),
          ),
        ),
      );
    }

    function SettingsPanel(props) {
      const {
        draft,
        onDraft,
        onSave,
        onClose,
        saveError,
        busy,
        bridgeAddr,
        token,
        port,
        sessions,
        copied,
        onCopy,
      } = props;
      const firstSession = sessions.length ? sessions[0] : null;
      const sessionText = sessions.length
        ? sessions.length +
          ' 个画布' +
          (firstSession && str(firstSession.canvasId)
            ? ' · ' + str(firstSession.canvasId)
            : '')
        : '无';
      return h(
        'div',
        { className: 'cb-scrim', onClick: onClose },
        h(
          'div',
          {
            className: 'cb-settings',
            role: 'dialog',
            'aria-label': '画布连接设置',
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'cb-settingshead' },
            h('span', { className: 'cb-settingstitle' }, '画布连接'),
            h('button', { className: 'cb-act', onClick: onClose, title: '关闭设置' }, '关闭'),
          ),
          h('span', { className: 'cb-label' }, '画布地址'),
          h(
            'div',
            { className: 'cb-inputrow' },
            h('input', {
              className: 'cb-input',
              placeholder: PLACEHOLDER,
              value: draft,
              spellCheck: false,
              autoComplete: 'off',
              'aria-label': '画布地址',
              onChange: (event) => onDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSave();
                }
              },
            }),
            h(
              'button',
              { className: 'cb-btn cb-btnfill cb-mini', onClick: onSave, disabled: busy },
              busy ? '保存中…' : '保存',
            ),
          ),
          saveError ? h('div', { className: 'cb-error', role: 'alert' }, saveError) : null,
          h('div', { className: 'cb-hr' }),
          h(KeyRow, {
            label: '桥地址',
            value: bridgeAddr || '——',
            action: h(
              'button',
              {
                className: 'cb-btn cb-mini' + (copied === 'bridge' ? ' cb-copied' : ''),
                onClick: () => onCopy('bridge', bridgeAddr),
                disabled: !bridgeAddr,
                title: '复制桥地址',
              },
              copied === 'bridge' ? '已复制' : '复制',
            ),
          }),
          h(KeyRow, {
            label: 'Token',
            value: maskToken(token) || '——',
            action: h(
              'button',
              {
                className: 'cb-btn cb-mini' + (copied === 'token' ? ' cb-copied' : ''),
                onClick: () => onCopy('token', token),
                disabled: !token,
                title: '复制完整连接凭据',
              },
              copied === 'token' ? '已复制' : '复制',
            ),
          }),
          h(KeyRow, { label: '端口', value: port ? String(port) : '——' }),
          h(KeyRow, { label: '已连接', value: sessionText }),
          h(
            'p',
            { className: 'cb-tiny' },
            'Token 只在本机使用，界面里始终掩码显示，点「复制」才拿到完整值，不会写进日志。',
          ),
        ),
      );
    }

    // ── 主面板 ──────────────────────────────────────────────────────────────

    function Panel() {
      const rootRef = React.useRef(null);
      const aliveRef = React.useRef(false);
      const ctrlRef = React.useRef(null);
      const inFlightRef = React.useRef(false);
      const frameForRef = React.useRef('');
      const frameKeyRef = React.useRef(0);
      const copiedTimerRef = React.useRef(null);

      const [status, setStatus] = React.useState('loading'); // loading | ready | error
      const [view, setView] = React.useState(null);
      const [hostError, setHostError] = React.useState('');
      const [frame, setFrame] = React.useState({ src: '', key: 0 });
      const [frameError, setFrameError] = React.useState('');
      const [token, setToken] = React.useState('');
      const [bridgeAddr, setBridgeAddr] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [saveError, setSaveError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [copied, setCopied] = React.useState('');
      const [hintClosed, setHintClosed] = React.useState(false);

      const signalOf = () => (ctrlRef.current ? ctrlRef.current.signal : undefined);

      // 向宿主要带凭据的地址：<canvasUrl>#agentUrl=<bridgeUrl>&agentToken=<token>
      // token 只进 iframe 的 src，不写 DOM 文本、不进日志。
      const openFrame = React.useCallback(async (canvasUrl) => {
        const opened = await postHost('open', {}, signalOf());
        const url = str(opened && opened.url);
        if (!url) {
          throw new Error('宿主没有返回画布地址：请在「设置」里重新保存画布地址后再试。');
        }
        const hashBridge = readHash(url, 'agentUrl');
        const hashToken = readHash(url, 'agentToken');
        frameKeyRef.current += 1;
        frameForRef.current = canvasUrl;
        setToken(hashToken);
        if (hashBridge) setBridgeAddr((current) => current || hashBridge);
        setFrame({ src: url, key: frameKeyRef.current });
        setFrameError('');
      }, []);

      const refreshState = React.useCallback(
        async (options) => {
          const force = !!(options && options.force);
          const probe = !!(options && options.probe);
          if (inFlightRef.current) return;
          inFlightRef.current = true;
          try {
            const next = normalizeState(await postHost(probe ? 'probe' : 'state', {}, signalOf()));
            if (!aliveRef.current) return;
            setView(next);
            if (next.bridgeUrl) setBridgeAddr(next.bridgeUrl);
            setHostError('');
            setStatus('ready');
            if (!next.canvasUrl) {
              frameForRef.current = '';
              setToken('');
              setFrame({ src: '', key: 0 });
              return;
            }
            // 轮询只更新状态；地址没变就不重挂 iframe，避免画布被反复重载。
            if (!force && frameForRef.current === next.canvasUrl) return;
            try {
              await openFrame(next.canvasUrl);
            } catch (failure) {
              if (!aliveRef.current) return;
              if (failure && failure.name === 'AbortError') return;
              setFrameError(reasonOf(failure, '获取画布连接地址失败。'));
            }
          } catch (failure) {
            if (!aliveRef.current) return;
            if (failure && failure.name === 'AbortError') return;
            setStatus('error');
            setHostError(reasonOf(failure, '读取画布状态失败。'));
          } finally {
            inFlightRef.current = false;
          }
        },
        [openFrame],
      );

      // 首次拉状态 + 3s 轮询；卸载时清定时器、中断在途请求。
      React.useEffect(() => {
        aliveRef.current = true;
        const controller = new AbortController();
        ctrlRef.current = controller;
        refreshState({ force: true });
        const timer = window.setInterval(() => {
          if (document.hidden) return;
          refreshState({ force: false });
        }, POLL_MS);
        return () => {
          aliveRef.current = false;
          controller.abort();
          window.clearInterval(timer);
          if (copiedTimerRef.current) {
            window.clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = null;
          }
        };
      }, [refreshState]);

      const save = async () => {
        if (busy) return;
        // 用户从已连接的画布复制来的地址可能带着 #agentUrl&agentToken，先清掉再校验。
        const value = draft.trim().replace(/#.*$/, '');
        if (!value) {
          setSaveError('先粘贴画布地址，例如 ' + PLACEHOLDER);
          return;
        }
        if (!isCanvasUrl(value)) {
          setSaveError(
            '地址格式不对：应为 http://localhost:3000/canvas/<画布ID>（只支持 http + localhost/127.0.0.1，必须带端口，路径是 /canvas/<画布id>）。',
          );
          return;
        }
        setBusy(true);
        setSaveError('');
        try {
          const next = normalizeState(await postHost('save', { canvasUrl: value }, signalOf()));
          if (!aliveRef.current) return;
          setView(next);
          if (next.bridgeUrl) setBridgeAddr(next.bridgeUrl);
          setHostError('');
          setStatus('ready');
          setSettingsOpen(false);
          setDraft('');
          try {
            await openFrame(next.canvasUrl || value);
          } catch (failure) {
            if (!aliveRef.current) return;
            if (failure && failure.name === 'AbortError') return;
            setFrameError(reasonOf(failure, '获取画布连接地址失败。'));
          }
        } catch (failure) {
          if (failure && failure.name === 'AbortError') return;
          if (!aliveRef.current) return;
          setSaveError(reasonOf(failure, '保存画布地址失败。'));
        } finally {
          if (aliveRef.current) setBusy(false);
        }
      };

      const copyValue = async (key, value) => {
        if (!value) return;
        const ok = await copyText(value, rootRef.current);
        if (!aliveRef.current) return;
        setCopied(ok ? key : '');
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => {
          copiedTimerRef.current = null;
          if (aliveRef.current) setCopied('');
        }, 1600);
      };

      const openSettings = () => {
        setDraft(view && view.canvasUrl ? view.canvasUrl : '');
        setSaveError('');
        setSettingsOpen(true);
      };

      const openInBrowser = () => {
        if (!frame.src) return;
        const win = window.open(frame.src, '_blank', 'noopener,noreferrer');
        if (win) win.opener = null;
      };

      // 四种状态：桥 / 站点 / 后端 / 画布连接。
      const sessions = view && Array.isArray(view.sessions) ? view.sessions : [];
      const bridgeTone = hostError ? 'bad' : view ? (view.bridgeUrl ? 'ok' : 'bad') : 'idle';
      const bridgeText = hostError ? '异常' : view ? (view.bridgeUrl ? '正常' : '未就绪') : '检测中';
      const siteOk = view ? view.site.ok : null;
      const backendOk = view ? view.backend.ok : null;
      const toneOf = (flag) => (flag === null || flag === undefined ? 'idle' : flag ? 'ok' : 'bad');
      const siteText = siteOk === null || siteOk === undefined ? '检测中' : siteOk ? '正常' : '异常';
      const backendText =
        backendOk === null || backendOk === undefined ? '检测中' : backendOk ? '正常' : '异常';
      const canvasText = view ? (sessions.length ? '已连接' : '未连接') : '检测中';
      const canvasTone = view ? (sessions.length ? 'ok' : 'bad') : 'idle';

      const alert = React.useMemo(() => {
        if (hostError) {
          return {
            level: 'error',
            title: '画布桥没有响应',
            detail: hostError,
            next: '确认 canvas-bridge 宿主插件已启用并重启 DSH，然后点「刷新」。',
          };
        }
        if (!view) return null;
        if (view.site.ok === false) {
          return {
            level: 'error',
            title: '画布站点未启动',
            detail:
              view.site.error || (view.site.url ? '打不开 ' + view.site.url : '站点探测失败。'),
            next: '下一步：先在画布仓库运行前端（pnpm dev），确认 /canvas 能打开，再点「刷新」重新探测。',
          };
        }
        if (view.backend.ok === false) {
          return {
            level: 'error',
            title: '画布后端未启动',
            detail: view.backend.error || '/api/health 没有响应。',
            next: '下一步：请先启动 Go 服务，再点「刷新」重新探测站点与后端。',
          };
        }
        if (!sessions.length) {
          return {
            level: 'info',
            title: '画布还没有连上桥',
            detail: '桥在运行，但还没有画布页建立连接。',
            next:
              '下一步：① 若画布区显示「还没有画布」，先点头像「登录」并完成登录；' +
              '② 再点「刷新」重载内嵌画布，让它带着连接参数重新打开并连上桥。',
          };
        }
        return null;
      }, [hostError, view, sessions.length]);

      const alertTitle = alert ? alert.title : '';
      React.useEffect(() => {
        setHintClosed(false);
      }, [alertTitle]);

      const barWarn = !!(alert && alert.level === 'error');
      const configured = !!(view && view.canvasUrl);

      let body = null;
      if (!view) {
        if (status === 'error') {
          body = h(
            CenterCard,
            {
              title: '画布面板还没接上宿主',
              detail: hostError,
              next: '下一步：确认 canvas-bridge 宿主插件已在当前 profile 启用，重启 DSH 后点「重试」。',
            },
            h(
              'button',
              { className: 'cb-btn cb-btnfill', onClick: () => refreshState({ force: true, probe: true }) },
              '重试',
            ),
            h('button', { className: 'cb-btn', onClick: openSettings }, '设置'),
          );
        } else {
          body = h(CenterCard, {
            title: '正在读取画布状态…',
            detail: '首次加载需要几秒，画布会在拿到连接凭据后自动打开。',
          });
        }
      } else if (!configured) {
        body = h(ConfigView, {
          draft,
          onDraft: setDraft,
          onSave: save,
          saveError,
          busy,
          bridgeAddr,
          hasToken: view.hasToken,
        });
      } else if (frameError) {
        body = h(
          CenterCard,
          {
            title: '取画布连接地址失败',
            detail: frameError,
            next: '下一步：点「重试」重新取地址；若地址被改过，请在「设置」里重新粘贴画布地址。',
          },
          h(
            'button',
            { className: 'cb-btn cb-btnfill', onClick: () => refreshState({ force: true, probe: true }) },
            '重试',
          ),
          h('button', { className: 'cb-btn', onClick: openSettings }, '设置'),
        );
      } else if (!frame.src) {
        body = h(CenterCard, {
          title: '正在打开画布…',
          detail: '拿到桥地址与凭据后，画布会铺满这块面板。',
        });
      } else {
        body = h(
          'div',
          { className: 'cb-body' },
          h('iframe', {
            key: 'cb-frame-' + frame.key,
            className: 'cb-frame',
            src: frame.src,
            title: 'Infinite Canvas 画布',
            sandbox: FRAME_SANDBOX,
            allow: 'clipboard-read; clipboard-write',
          }),
          alert && !hintClosed
            ? h(
                'div',
                { className: 'cb-hint' + (alert.level === 'info' ? ' cb-hint-info' : '') },
                h(
                  'div',
                  { className: 'cb-hintbody' },
                  h('div', { className: 'cb-hinttitle' }, alert.title),
                  h(
                    'div',
                    { className: 'cb-hinttext' },
                    (alert.detail ? alert.detail + ' ' : '') + alert.next,
                  ),
                ),
                h(
                  'div',
                  { className: 'cb-hintactions' },
                  h(
                    'button',
                    {
                      className: 'cb-btn cb-mini',
                      onClick: () => refreshState({ force: true, probe: true }),
                    },
                    '重新探测',
                  ),
                  h(
                    'button',
                    {
                      className: 'cb-act',
                      onClick: () => setHintClosed(true),
                      title: '暂时关闭提示',
                    },
                    '×',
                  ),
                ),
              )
            : null,
        );
      }

      return h(
        'div',
        { className: 'cb-root', ref: rootRef },
        h('style', null, CSS),
        h(
          'div',
          { className: 'cb-bar' + (barWarn ? ' cb-bar-warn' : '') },
          h(
            'div',
            { className: 'cb-stats' },
            h(StatusItem, { label: '桥', tone: bridgeTone, text: bridgeText }),
            h(StatusItem, { label: '站点', tone: toneOf(siteOk), text: siteText }),
            h(StatusItem, { label: '后端', tone: toneOf(backendOk), text: backendText }),
            h(StatusItem, { label: '画布', tone: canvasTone, text: canvasText }),
          ),
          alert
            ? h(
                'span',
                {
                  className: 'cb-reason',
                  title: alert.title + '：' + alert.detail + ' ' + alert.next,
                },
                alert.title + '：' + alert.next,
              )
            : null,
          h(
            'div',
            { className: 'cb-actions' },
            h('button', { className: 'cb-act', onClick: openSettings, title: '画布地址与连接凭据' }, '设置'),
            h(
              'button',
              {
                className: 'cb-act',
                onClick: () => refreshState({ force: true, probe: true }),
                title: '重新探测站点、后端并重载画布',
              },
              '刷新',
            ),
            h(
              'button',
              {
                className: 'cb-act',
                onClick: openInBrowser,
                disabled: !frame.src,
                title: '在系统浏览器打开当前画布',
              },
              '在浏览器打开',
            ),
          ),
        ),
        body,
        settingsOpen
          ? h(SettingsPanel, {
              draft,
              onDraft: setDraft,
              onSave: save,
              onClose: () => {
                setSettingsOpen(false);
                setSaveError('');
              },
              saveError,
              busy,
              bridgeAddr,
              token,
              port: view ? view.port : null,
              sessions,
              copied,
              onCopy: copyValue,
            })
          : null,
      );
    }

    // 侧栏图标：画布框 + 两个节点 + 连线（与 icon.svg 同一套线条）。
    function PanelIcon({ size, active }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.7 },
        },
        h('rect', { x: 2.75, y: 4.25, width: 18.5, height: 15.5, rx: 2.75 }),
        h('circle', { cx: 8.6, cy: 10.2, r: 1.9 }),
        h('circle', { cx: 15.4, cy: 14.1, r: 1.9 }),
        h('path', { d: 'M10.25 11.05 13.75 13.25' }),
        h('path', { d: 'M6.1 16.9h3.4' }),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'canvas-bridge', order: 21, label: '画布' },
            PanelIcon,
          ),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'canvas-bridge' }, Panel),
        );
      },
    };
  },
});
