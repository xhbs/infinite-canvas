/**
 * canvas-bridge 宿主插件（A / 宿主侧）。
 *
 * 职责：
 *   1. 在 127.0.0.1 上起一个桥 HTTP 服务，画布页面用它做「外接执行端」；
 *   2. 把画布的工具清单注册成 DSH 原生工具（canvas_<原名>）；
 *   3. 给侧栏面板提供 /api/canvas-bridge 路由（state/save/open/probe）。
 *
 * 契约见同目录 SPEC.md。纯 ESM，只用 node: 内置模块。
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const name = 'canvas-bridge';
export const inject = ['tools'];

/* ------------------------------------------------------------------ 常量 */

const DEFAULT_PORT = 3211;
const PORT_CANDIDATES = [3211, 3212, 3213, 3214, 3215, 3216, 3217, 3218, 3219, 3220];

const QUEUE_LIMIT_MS = 30_000; // 排队超过这个时间直接失败
const DEFAULT_TIMEOUT_MS = 60_000;
const HEAVY_TIMEOUT_MS = 180_000;
const STATUS_TIMEOUT_MS = 30_000;
const HEARTBEAT_MS = 15_000;
const RECONNECT_GRACE_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;
const PROBE_CACHE_MS = 4_000;
const RENDER_LIMIT = 4_000;
const BODY_LIMIT = 64 * 1024 * 1024; // 64MB：容纳单张最大 40MB 图片的 Base64（约 53MB）

const HEAVY_TOOLS = new Set([
  'generate_image',
  'edit_image',
  'generate_video',
  'generate_audio',
  'import_image_data',
]);
const STATUS_TOOLS = new Set(['get_media_task_status', 'get_generation_task']);

/** 页面自用的工具，不移交给模型（否则模型会自己改画布内部状态）。 */
const EXCLUDED_TOOLS = new Set(['set_agent_state', 'read_skill_file']);

const TOOL_PREFIX = 'canvas_';
const PANEL_ROUTE = '/api/canvas-bridge';
const PANEL_HEADER = 'x-canvas-bridge';

/* --------------------------------------------------------- 媒体仓库常量 */

/** 单文件上限 512MB；CANVAS_BRIDGE_MEDIA_MAX_BYTES 只给自检/排障用。 */
const MEDIA_LIMIT_MB = 512;
const MEDIA_MAX_BYTES = (() => {
  const raw = Number(process.env.CANVAS_BRIDGE_MEDIA_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MEDIA_LIMIT_MB * 1024 * 1024;
})();
/** storageKey 长度上限（画布的 image:/generated-video: 键远小于这个值）。 */
const MEDIA_KEY_LIMIT = 512;
const MEDIA_DEFAULT_MIME = 'application/octet-stream';
/** 跨域读媒体时前端要能读到这几个头（Range / 长度）。 */
const MEDIA_EXPOSE_HEADERS = {
  'Access-Control-Expose-Headers': 'content-length,content-range,accept-ranges,content-type',
};

/* ------------------------------------------------------------------ 工具 */

const str = (value) => (typeof value === 'string' ? value : '');

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function errorText(error) {
  if (error instanceof Error && error.message) return error.message;
  const text = str(error);
  return text || '未知错误';
}

/** token 只允许以掩码形式出现在日志/工具输出里。 */
function maskToken(token) {
  const value = str(token);
  if (!value) return '(未设置)';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

/** 媒体 storageKey 的日志形式：只留前 12 个字符。 */
function mediaKeyPreview(key) {
  const value = str(key);
  return value.length <= 12 ? value : value.slice(0, 12) + '…';
}

/** storageKey → 落盘文件名（sha256，可避免任何路径穿越与文件名非法字符）。 */
function mediaHash(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** 上限的中文表述，默认渲染成「512MB」。 */
function mediaLimitText() {
  if (MEDIA_MAX_BYTES >= 1024 * 1024) {
    const mb = MEDIA_MAX_BYTES / (1024 * 1024);
    return (Number.isInteger(mb) ? String(mb) : mb.toFixed(1)) + 'MB';
  }
  return Math.max(1, Math.round(MEDIA_MAX_BYTES / 1024)) + 'KB';
}

/** 媒体 storageKey 合法性：单段、不含 ..、不含分隔符与控制字符。 */
function mediaKeyValid(key) {
  if (!key || key.length > MEDIA_KEY_LIMIT) return false;
  if (key === '.' || key === '..') return false;
  if (key.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\\/\u0000-\u001f\u007f]/.test(key);
}

function mediaMime(raw) {
  const value = str(raw).split(';')[0].trim().toLowerCase();
  if (!value || value.length > 120) return MEDIA_DEFAULT_MIME;
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value) ? value : MEDIA_DEFAULT_MIME;
}

/**
 * 解析单段 Range 头。
 * @returns {null | 'invalid' | {start:number,end:number}}
 */
function parseRangeHeader(raw, size) {
  const header = str(raw).trim();
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return 'invalid';
  const [, from, to] = match;
  if (!from && !to) return 'invalid';
  if (!from) {
    const suffix = Number(to);
    if (!Number.isFinite(suffix) || suffix <= 0 || size <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to ? Number(to) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (size <= 0 || start >= size || start > end) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (one) => String(one).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}

/* ------------------------------------------------------------- 设置存储 */

function bridgeHome() {
  return process.env.CANVAS_BRIDGE_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'canvas-bridge');
}

/** 本机画布桥的设置文件。 */
function settingsFile() {
  return path.join(bridgeHome(), 'settings.json');
}

const HEX64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizePort(value) {
  const port = Number(value);
  return PORT_CANDIDATES.includes(port) ? port : DEFAULT_PORT;
}

function readSettings(log) {
  const file = settingsFile();
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    raw = null;
  }
  const source = isRecord(raw) ? raw : {};
  const token = HEX64.test(str(source.token)) ? str(source.token) : randomBytes(32).toString('hex');
  const settings = {
    port: normalizePort(source.port),
    token,
    canvasUrl: str(source.canvasUrl),
    serviceId: UUID.test(str(source.serviceId)) ? str(source.serviceId) : randomUUID(),
  };
  const dirty =
    !isRecord(raw) ||
    settings.port !== source.port ||
    settings.token !== source.token ||
    settings.canvasUrl !== source.canvasUrl ||
    settings.serviceId !== source.serviceId;
  if (dirty) {
    try {
      writeSettings(settings);
    } catch (error) {
      log('设置文件写入失败（仍用内存中的设置继续运行）：' + errorText(error));
    }
  }
  return settings;
}

function writeSettings(settings) {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
  } catch {
    /* Windows 上 chmod 只影响只读位，忽略 */
  }
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* 同上 */
  }
  return settings;
}

/* ------------------------------------------------------- schema 清洗 */

/**
 * DSH 的 schema 子集只接受：
 *   type/oneOf/properties/required/additionalProperties/items/enum/const
 *   + 注解 description/title/default/examples
 * 并且（比对 DSH 源码里的校验器）：
 *   - oneOf 不能与 type / properties / required / additionalProperties / items / enum / const 共存；
 *   - oneOf 至少两个分支；
 *   - properties/required/additionalProperties 只能出现在 type=object 上，items 只能出现在 array 上，
 *     enum/const 只能出现在标量类型上且值的类型必须匹配；
 *   - required 的键必须在 properties 里。
 * 画布页面给的是完整 JSON Schema（带 maxLength/minItems/minimum/pattern/format/default…），
 * 这里递归裁掉多余关键字并顺带修正上面这些硬约束。
 */
const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean', 'null'];
const ALL_TYPES = ['object', 'array'].concat(SCALAR_TYPES);

function scalarMatches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

/** 一组标量值如果能归到同一个类型上，返回该类型。 */
function commonScalarType(values) {
  const usable = values.filter((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value));
  if (!usable.length) return '';
  for (const type of SCALAR_TYPES) {
    if (usable.every((value) => scalarMatches(type, value))) {
      // 整数要优先于 number，否则 {1,2} 会被判成 number
      if (type === 'number') {
        const asInteger = usable.every((value) => scalarMatches('integer', value));
        if (asInteger) return 'integer';
      }
      return type;
    }
  }
  return '';
}

function inferType(node) {
  if (node.properties !== undefined || node.required !== undefined || node.additionalProperties !== undefined) {
    return 'object';
  }
  if (node.items !== undefined) return 'array';
  if (Array.isArray(node.enum)) {
    const type = commonScalarType(node.enum);
    if (type) return type;
  }
  if (node.const !== undefined) {
    const type = commonScalarType([node.const]);
    if (type) return type;
  }
  return '';
}

/** 递归清洗一个 schema 节点，返回符合 DSH 子集的节点。 */
function cleanNode(node) {
  if (!isRecord(node)) return {};
  const out = {};
  if (typeof node.title === 'string') out.title = node.title;
  if (typeof node.description === 'string') out.description = node.description;

  // oneOf 优先：DSH 不允许它和 type/兄弟约束同时出现，保留 oneOf 丢掉其余约束。
  if (Array.isArray(node.oneOf)) {
    const branches = node.oneOf.map(cleanNode);
    if (branches.length >= 2) {
      out.oneOf = branches;
      return out;
    }
  }

  const declared = typeof node.type === 'string' && ALL_TYPES.includes(node.type) ? node.type : '';
  const type = declared || inferType(node);
  if (!type) return out; // 只有注解：在 DSH 里等价于「任意 JSON」
  out.type = type;

  if (type === 'object') {
    if (isRecord(node.properties)) {
      const properties = {};
      for (const key of Object.keys(node.properties)) properties[key] = cleanNode(node.properties[key]);
      out.properties = properties;
    }
    if (Array.isArray(node.required)) {
      const declaredProps = out.properties || {};
      const seen = new Set();
      const required = [];
      for (const key of node.required) {
        if (typeof key !== 'string' || seen.has(key) || !Object.hasOwn(declaredProps, key)) continue;
        seen.add(key);
        required.push(key);
      }
      if (required.length) out.required = required;
    }
    if (typeof node.additionalProperties === 'boolean') out.additionalProperties = node.additionalProperties;
  } else if (type === 'array') {
    if (node.items !== undefined) out.items = cleanNode(node.items);
  } else {
    if (Array.isArray(node.enum)) {
      const values = node.enum.filter((value) => scalarMatches(type, value));
      if (values.length) out.enum = values;
    }
    if (node.const !== undefined && scalarMatches(type, node.const)) {
      if (!out.enum || out.enum.includes(node.const)) out.const = node.const;
    }
  }
  return out;
}

/** 顶层清洗：根节点强制 object。 */
export function cleanToolSchema(inputSchema) {
  const cleaned = cleanNode(isRecord(inputSchema) ? inputSchema : {});
  if (cleaned.type !== 'object') {
    // 根不是 object（含 oneOf 根、空 schema）时退化为无约束 object
    return { type: 'object', additionalProperties: true };
  }
  if (!Object.keys(cleaned).length) return { type: 'object', additionalProperties: true };
  return cleaned;
}

/* --------------------------------------------------------------- 超时 */

function timeoutFor(toolName) {
  if (HEAVY_TOOLS.has(toolName)) return HEAVY_TIMEOUT_MS;
  if (STATUS_TOOLS.has(toolName)) return STATUS_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

/* ------------------------------------------------------------- 主流程 */

export function apply(ctx) {
  const runtime = {
    settings: null,
    server: null,
    port: 0,
    sockets: new Set(),
    sessions: new Map(),
    dynamic: new Map(),
    metaTools: new Map(),
    stopped: false,
    lastCall: null,
    startError: '',
    notes: [],
  };

  const log = (message) => {
    const logger = ctx.logger;
    if (logger && typeof logger.warn === 'function') logger.warn(message);
    else console.warn('[canvas-bridge] ' + message);
  };

  /** 记录一条诊断（同时进 canvas_status，方便用户把问题贴回来）。 */
  const note = (message) => {
    runtime.notes.push(message);
    if (runtime.notes.length > 20) runtime.notes.shift();
    log(message);
  };

  /** 带错误码的失败，方便判断桥级故障还是画布自己报错。 */
  function failure(code, message) {
    const error = new Error(message);
    error.canvasCode = code;
    return error;
  }

  /* ------------------------------ 设置 ------------------------------ */

  runtime.settings = readSettings(log);

  const bridgeUrl = () => 'http://127.0.0.1:' + (runtime.port || runtime.settings.port);

  function saveSettings(patch) {
    runtime.settings = writeSettings({ ...runtime.settings, ...patch });
    return runtime.settings;
  }

  function siteOrigin() {
    const canvasUrl = str(runtime.settings.canvasUrl);
    if (!canvasUrl) return '';
    try {
      return new URL(canvasUrl).origin;
    } catch {
      return '';
    }
  }

  /* --------------------------- 站点探测 --------------------------- */

  let probeCache = { at: 0, value: null };

  async function probeOne(url, label) {
    if (typeof fetch !== 'function') {
      return { ok: false, url, error: '当前 Node 没有全局 fetch，无法探测' + label };
    }
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.status >= 200 && response.status < 400) return { ok: true, url };
      return { ok: false, url, error: label + '返回 HTTP ' + response.status };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? '请求超时（' + PROBE_TIMEOUT_MS / 1000 + 's）'
          : errorText(error);
      return { ok: false, url, error: '连不上' + label + '：' + reason };
    }
  }

  async function probeAll(force) {
    if (!force && probeCache.value && Date.now() - probeCache.at < PROBE_CACHE_MS) return probeCache.value;
    const origin = siteOrigin();
    let value;
    if (!origin) {
      const offline = { ok: false, url: '', error: '还没配置画布地址：请先在侧栏「画布」里粘贴画布地址并保存' };
      value = { site: offline, backend: { ...offline } };
    } else {
      const [site, backend] = await Promise.all([
        probeOne(origin + '/canvas', '站点'),
        probeOne(origin + '/api/health', '后端'),
      ]);
      value = { site, backend };
    }
    probeCache = { at: Date.now(), value };
    return value;
  }

  /* --------------------------- 会话管理 --------------------------- */

  function ensureSession(clientId) {
    let session = runtime.sessions.get(clientId);
    if (session) return session;
    session = {
      clientId,
      canvasId: '',
      tools: [],
      res: null,
      connectedAt: 0,
      ready: false,
      superseded: false,
      queue: Promise.resolve(),
      pending: new Map(),
      heartbeat: null,
      reconnect: null,
    };
    runtime.sessions.set(clientId, session);
    return session;
  }

  function readySessions() {
    return [...runtime.sessions.values()].filter((one) => one.ready && !one.superseded);
  }

  function clearHeartbeat(session) {
    if (session.heartbeat) {
      clearInterval(session.heartbeat);
      session.heartbeat = null;
    }
  }

  function clearReconnect(session) {
    if (session.reconnect) {
      clearTimeout(session.reconnect);
      session.reconnect = null;
    }
  }

  /** 拒绝这个会话上所有还在等的调用。 */
  function rejectPending(session, code, message) {
    const waiters = [...session.pending.values()];
    session.pending.clear();
    for (const waiter of waiters) waiter.fail(failure(code, message));
  }

  function closeStream(session) {
    clearHeartbeat(session);
    const res = session.res;
    session.res = null;
    if (res && !res.writableEnded) {
      try {
        res.end();
      } catch {
        /* 已经断开了 */
      }
    }
  }

  function dropSession(session, reason) {
    clearReconnect(session);
    closeStream(session);
    rejectPending(session, 'canvas_reconnected', reason);
    if (runtime.sessions.get(session.clientId) === session) runtime.sessions.delete(session.clientId);
  }

  function supersede(session, reason) {
    if (session.superseded) return;
    session.superseded = true;
    note('画布会话已被新连接取代（clientId=' + session.clientId + '）：' + reason);
    rejectPending(session, 'canvas_reconnected', reason);
    closeStream(session);
    clearReconnect(session);
  }

  /** 选目标会话：显式 clientId/canvasId > 唯一已连接会话 > 报错。 */
  function pickSession(target) {
    const wanted = target || {};
    if (wanted.clientId) {
      const session = runtime.sessions.get(str(wanted.clientId));
      if (!session || !session.ready) {
        throw failure(
          'canvas_not_connected',
          '这条画布连接不存在或已断开：请刷新 DSH 侧栏「画布」面板重新建立连接，然后用 canvas_status 确认已连接',
        );
      }
      if (session.superseded) {
        throw failure(
          'canvas_reconnected',
          '这条画布连接已被同一画布的新连接取代：请直接用 canvas_status 看当前画布，再重试一次',
        );
      }
      return session;
    }
    const alive = readySessions();
    if (wanted.canvasId) {
      const wantedCanvasId = str(wanted.canvasId);
      const session = alive.find((one) => one.canvasId === wantedCanvasId);
      if (!session) {
        throw failure(
          'canvas_not_connected',
          '找不到 canvasId 为 ' +
            wantedCanvasId +
            ' 的已连接画布（当前已连接 ' +
            alive.length +
            ' 个）：请用 canvas_list_canvases 看可用画布，或在侧栏「画布」里打开它',
        );
      }
      return session;
    }
    if (alive.length === 1) return alive[0];
    if (alive.length > 1) {
      // 多个画布同时连接时默认选最近连接的那个，避免模型被迫“关掉另一个画布”
      const latest = alive.slice().sort((a, b) => b.connectedAt - a.connectedAt)[0];
      if (!latest) throw failure('canvas_not_connected', '画布未连接：请在 DSH 侧栏「画布」中打开画布');
      runtime.lastAutoPick = { canvasId: latest.canvasId, at: new Date() };
      return latest;
    }
    throw failure(
      'canvas_not_connected',
      '画布未连接：请在 DSH 侧栏「画布」中打开画布；如果用了外部浏览器，请从侧栏「画布」复制带连接参数的地址打开一次',
    );
  }

  /**
   * 多画布时的自动选择说明，拼进工具结果，让调用方知道实际作用在哪张画布。
   * 只有本次调用没有显式指定 canvasId/clientId、且当前连接超过一张时才返回说明。
   */
  function autoPickNote(session, hadExplicitTarget) {
    if (hadExplicitTarget) return '';
    const alive = readySessions();
    if (alive.length <= 1) return '';
    return '（当前连接 ' + alive.length + ' 张画布，已自动选择最近连接的 ' + (session.canvasId || '未知') + '；如需指定别的画布，传 canvasId）';
  }

  /* ----------------------------- SSE ----------------------------- */

  function sseSend(session, event, data) {
    const res = session.res;
    if (!res || res.writableEnded || res.destroyed) return false;
    try {
      res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
      return true;
    } catch {
      return false;
    }
  }

  /* -------------------------- 调用（串行） -------------------------- */

  /** 每会话一条 FIFO 队列；排队超 30s 直接失败。 */
  function enqueue(session, task) {
    const queuedAt = Date.now();
    const run = session.queue.then(() => {
      if (runtime.stopped) {
        throw failure('canvas_stopped', '画布桥已停止：插件被卸载或重载，请重启 DSH 后再调用画布工具');
      }
      if (Date.now() - queuedAt > QUEUE_LIMIT_MS) {
        throw failure('canvas_busy', '画布正忙，请稍后重试');
      }
      return task();
    });
    session.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 一次具体的画布调用：SSE 下发 tool，等 /result 或超时。 */
  function dispatch(session, toolName, args, signal) {
    if (session.superseded) {
      throw failure(
        'canvas_reconnected',
        '画布已重新连接，这条调用属于旧连接：请用 canvas_status 确认后重试一次',
      );
    }
    if (!session.res || session.res.writableEnded) {
      throw failure(
        'canvas_not_connected',
        '画布页面没有建立长连接：请在 DSH 侧栏「画布」里刷新面板，页面会自动重连后再重试',
      );
    }
    const requestId = randomUUID();
    const timeoutMs = timeoutFor(toolName);
    const seconds = Math.round(timeoutMs / 1000);
    const sent = sseSend(session, 'tool', {
      requestId,
      source: 'external',
      generation: 0,
      name: toolName,
      arguments: args,
    });
    if (!sent) {
      throw failure(
        'canvas_not_connected',
        '画布长连接已断开，工具请求没有发出去：请在 DSH 侧栏「画布」里刷新面板后重试',
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const waiter = {};
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        timer = null;
        session.pending.delete(requestId);
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
        fn(value);
      };
      const cancelOnPage = () => sseSend(session, 'tool-cancel', { requestId });
      const onAbort = () => {
        cancelOnPage();
        const error = new Error('画布调用已取消（' + toolName + '）：如果需要结果请重新调用');
        error.name = 'AbortError';
        error.canvasCode = 'canvas_aborted';
        finish(reject, error);
      };
      waiter.resolve = (value) => finish(resolve, value);
      waiter.fail = (error) => finish(reject, error);
      session.pending.set(requestId, waiter);
      timer = setTimeout(() => {
        cancelOnPage();
        finish(
          reject,
          failure(
            'canvas_timeout',
            '画布未在 ' +
              seconds +
              's 内返回结果（' +
              toolName +
              '）：请稍后重试；若一直超时，用 canvas_status 确认画布仍是连接状态',
          ),
        );
      }, timeoutMs);
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        if (typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
      runtime.lastCall = { tool: TOOL_PREFIX + toolName, at: new Date(), ok: null };
    });
  }

  /** 对外统一入口：选会话 → 排队 → 下发。canvasId 支持两种来源：target 参数，或 args.canvasId。 */
  async function invokeCanvasTool(toolName, args, signal, target, source) {
    const rawArgs = isRecord(args) ? args : {};
    const wanted = target && (target.canvasId || target.clientId)
      ? target
      : { canvasId: str(rawArgs.canvasId) };
    // canvasId 只用于选会话，不能透传给画布页面（页面会把它当成未知参数）
    const pageArgs = { ...rawArgs };
    delete pageArgs.canvasId;
    delete pageArgs.clientId;
    const session = pickSession(wanted);
    // 桥自己合成的调用（例如按路径导入内部再走 import_image_data）不在这里校验工具清单：
    // 页面版本可能尚未上报该工具，但直接下发仍可执行；校验交给页面返回更准确的错误。
    if (source !== 'bridge') {
      const knownTools = session.tools.map((one) => one.name);
      if (!knownTools.includes(toolName)) {
        const known = knownTools.slice(0, 40).join('、');
        throw failure(
          'canvas_unknown_tool',
          '画布上没有名为 ' + toolName + ' 的工具（可能是页面版本变了）：当前可用工具：' + (known || '无') +
            '；请刷新侧栏「画布」面板让工具清单重新同步',
        );
      }
    }
    const result = await enqueue(session, () => dispatch(session, toolName, pageArgs, signal));
    if (runtime.lastCall) {
      runtime.lastCall.ok = !(result && result.ok === false);
      runtime.lastCall.at = new Date();
    }
    // 多画布且未显式指定时，把“实际作用在哪张画布”带回给调用方（仅追加说明，不改画布原始字段）
    const note = autoPickNote(session, Boolean(wanted.canvasId || wanted.clientId));
    if (!note) return result;
    const annotated = isRecord(result) ? { ...result, canvasId: session.canvasId, note } : result;
    return annotated;
  }

  /* ---------------------- 动态注册画布工具 ---------------------- */

  function disposeDynamic() {
    for (const [toolName, dispose] of runtime.dynamic) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch (error) {
        log('画布工具 ' + toolName + ' 注销失败：' + errorText(error));
      }
    }
    runtime.dynamic.clear();
  }

  function renderCanvasResult(toolName, value) {
    if (!isRecord(value)) return '完成 ' + toolName + (value === undefined ? '' : '\n' + String(value));
    if (value.ok === false) return '失败：' + (str(value.message) || str(value.code) || '未知错误');
    let json = '';
    try {
      json = JSON.stringify(value);
    } catch {
      json = String(value);
    }
    return '完成 ' + toolName + (json ? '\n' + json.slice(0, RENDER_LIMIT) : '');
  }

  function registerCanvasTool(tool) {
    const shortName = tool.name;
    const toolName = TOOL_PREFIX + shortName;
    const baseSchema = cleanToolSchema(tool.inputSchema);
    // 给每个画布工具补一个可选 canvasId：多画布并行时由模型自己指定，不必关闭其它面板
    const parameters = baseSchema && baseSchema.type === 'object'
      ? {
          ...baseSchema,
          properties: {
            ...(baseSchema.properties || {}),
            canvasId: {
              type: 'string',
              description: '目标画布 ID。同时连接多张画布时用它指定；只连一张可省略（默认最近连接的那张）。可先用 canvas_list_canvases 查看。',
            },
          },
        }
      : {
          type: 'object',
          additionalProperties: true,
          properties: {
            canvasId: {
              type: 'string',
              description: '目标画布 ID。同时连接多张画布时用它指定；只连一张可省略（默认最近连接的那张）。',
            },
          },
        };
    const definition = {
      name: toolName,
      description: '[画布] ' + (str(tool.description).trim() || shortName),
      parameters,
      output: {
        schema: {},
        render: (_args, value) => [{ type: 'text', text: renderCanvasResult(shortName, value) }],
      },
      // 画布是单写者，统一走串行队列
      isConcurrencySafe: () => false,
      execute: (args, exec) => invokeCanvasTool(shortName, isRecord(args) ? args : {}, exec && exec.signal),
    };
    const existing = runtime.dynamic.get(toolName);
    if (existing) {
      try {
        existing();
      } catch {
        /* 旧的已经不在了 */
      }
      runtime.dynamic.delete(toolName);
    }
    const dispose = ctx.tools.register(definition);
    runtime.dynamic.set(toolName, dispose);
  }

  /** 画布连上来时重建动态工具；单个工具失败不影响其余。 */
  function syncDynamicTools(session) {
    disposeDynamic();
    let registered = 0;
    for (const tool of session.tools) {
      if (EXCLUDED_TOOLS.has(tool.name)) continue;
      try {
        registerCanvasTool(tool);
        registered += 1;
      } catch (error) {
        note('画布工具 ' + tool.name + ' 注册失败（已跳过）：' + errorText(error));
      }
    }
    log('已按画布工具清单注册 ' + registered + ' 个原生工具（canvasId=' + (session.canvasId || '(空)') + '）');
  }

  /* --------------------------- 元工具实现 --------------------------- */

  const PATH_IMAGE_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
  };
  const PATH_IMAGE_LIMIT = 40 * 1024 * 1024;

  /**
   * 读取本机图片并转成 import_image_data 调用。
   * 放在桥进程里读文件，避免模型把几 MB 的 Base64 塞进一次工具调用。
   */
  async function importImageByPath(filePath, signal, target) {
    const absolute = path.resolve(String(filePath));
    const ext = path.extname(absolute).toLowerCase();
    const mimeType = PATH_IMAGE_MIME[ext];
    if (!mimeType) throw new Error('仅支持 PNG、JPEG、WebP、GIF、AVIF，当前扩展名：' + (ext || '(无)'));
    if (!fs.existsSync(absolute)) throw new Error('文件不存在：' + absolute);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new Error('不是文件：' + absolute);
    if (!stat.size) throw new Error('文件为空：' + absolute);
    if (stat.size > PATH_IMAGE_LIMIT) throw new Error('图片超过 40MB 上限（' + Math.round(stat.size / 1024 / 1024) + 'MB）');
    const dataBase64 = fs.readFileSync(absolute).toString('base64');
    const result = await invokeCanvasTool(
      'import_image_data',
      { fileName: path.basename(absolute), mimeType, dataBase64 },
      signal,
      target,
      'bridge',
    );
    if (!isRecord(result) || result.ok === false) {
      throw new Error((isRecord(result) && (str(result.message) || str(result.code))) || '画布导入失败');
    }
    return result;
  }

  function sessionLine(session) {
    return (
      '- canvasId=' +
      (session.canvasId || '(空)') +
      '  clientId=' +
      session.clientId +
      '  工具 ' +
      session.tools.length +
      ' 个  连接于 ' +
      (session.connectedAt ? formatTime(session.connectedAt) : '未知')
    );
  }

  async function statusText() {
    const settings = runtime.settings;
    const lines = [];
    lines.push('画布桥：' + bridgeUrl() + (runtime.server ? '（运行中）' : '（未运行：' + (runtime.startError || '正在启动') + '）'));
    lines.push('连接凭据：' + maskToken(settings.token) + '（已写入 ' + settingsFile() + '）');
    lines.push('画布地址设置：' + (settings.canvasUrl || '未配置（请在 DSH 侧栏「画布」里粘贴画布地址）'));
    const probe = await probeAll(false);
    lines.push('站点：' + (probe.site.ok ? '可用' : '不可用') + (probe.site.error ? '（' + probe.site.error + '）' : ''));
    lines.push('后端：' + (probe.backend.ok ? '可用' : '不可用') + (probe.backend.error ? '（' + probe.backend.error + '）' : ''));
    const alive = readySessions();
    lines.push('已连接画布：' + alive.length + ' 个');
    if (!alive.length) lines.push('  （还没有画布连接：在 DSH 侧栏「画布」里打开画布后会自动连上）');
    for (const session of alive) lines.push(sessionLine(session));
    if (runtime.lastCall) {
      const state = runtime.lastCall.ok === null ? '进行中' : runtime.lastCall.ok ? 'ok' : '失败';
      lines.push('最近一次调用：' + runtime.lastCall.tool + '（' + state + '，' + formatTime(runtime.lastCall.at) + '）');
    } else {
      lines.push('最近一次调用：暂无');
    }
    if (runtime.notes.length) {
      lines.push('最近诊断：');
      for (const entry of runtime.notes.slice(-5)) lines.push('  · ' + entry);
    }
    return lines.join('\n');
  }

  const CANVAS_URL_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})\/canvas\/([A-Za-z0-9._~-]+)\/?$/;

  function normalizeCanvasUrl(value) {
    const raw = str(value).trim();
    if (!raw) throw failure('bad_canvas_url', '画布地址是空的：应形如 http://localhost:3000/canvas/xxxx');
    const match = CANVAS_URL_PATTERN.exec(raw.replace(/#.*$/, ''));
    if (!match) {
      throw failure(
        'bad_canvas_url',
        '画布地址格式不对：应形如 http://localhost:3000/canvas/xxxx 或 http://127.0.0.1:3000/canvas/xxxx（只允许 localhost/127.0.0.1，路径必须是 /canvas/<画布id>）',
      );
    }
    return 'http://' + match[1] + ':' + match[2] + '/canvas/' + match[3];
  }

  /** 计算画布页面地址（不含 hash）。canvasId 省略时用设置里的画布地址。 */
  function baseCanvasUrl(canvasId) {
    const wanted = str(canvasId).trim();
    if (wanted) {
      const origin = siteOrigin();
      if (!origin) {
        throw failure(
          'bad_canvas_url',
          '还没配置画布地址，无法按 canvasId 拼地址：请先在侧栏「画布」里粘贴一次画布地址并保存',
        );
      }
      return origin + '/canvas/' + wanted.replace(/[^A-Za-z0-9._~-]/g, '');
    }
    const base = str(runtime.settings.canvasUrl);
    if (!base) {
      throw failure(
        'bad_canvas_url',
        '还没配置画布地址：请先在 DSH 侧栏「画布」里粘贴 http://localhost:3000/canvas/xxxx 并保存',
      );
    }
    return base.replace(/#.*$/, '');
  }

  /** 拼出带 #agentUrl&agentToken 的连接地址（页面据此自动连接）。 */
  function connectionUrl(canvasId) {
    return (
      baseCanvasUrl(canvasId) +
      '#agentUrl=' +
      encodeURIComponent(bridgeUrl()) +
      '&agentToken=' +
      encodeURIComponent(str(runtime.settings.token))
    );
  }

  function openInBrowser(url) {
    const options = { detached: true, stdio: 'ignore' };
    try {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], options).unref();
      else if (process.platform === 'darwin') spawn('open', [url], options).unref();
      else spawn('xdg-open', [url], options).unref();
      return true;
    } catch (error) {
      log('打开系统浏览器失败：' + errorText(error));
      return false;
    }
  }

  /* --------------------------- 工具注册 --------------------------- */

  function registerMetaTools() {
    const tools = [
      {
        name: 'canvas_status',
        description:
          '查看画布桥状态：桥地址与端口、画布地址设置、站点/后端是否可用、已连接画布会话、最近一次调用。' +
          '画布工具调用失败（未连接、超时、画布正忙）时先用它确认状态，再去侧栏「画布」里打开或刷新画布。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        output: {
          schema: {},
          render: (_args, value) => [{ type: 'text', text: str(value && value.text) }],
        },
        isConcurrencySafe: () => true,
        execute: async () => ({ ok: true, text: await statusText() }),
      },
      {
        name: 'canvas_open',
        description:
          '在系统浏览器里打开画布页面，并返回带 #agentUrl & agentToken 的连接地址（token 以掩码显示）。' +
          '参数 canvasId 可省略，省略时用侧栏里保存的画布地址。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            canvasId: { type: 'string', description: '画布 id（画布地址里 /canvas/ 后面那一段）。' },
          },
        },
        output: {
          schema: {},
          render: (_args, value) => [{ type: 'text', text: str(value && value.text) }],
        },
        isConcurrencySafe: () => false,
        execute: async (args) => {
          let base;
          let link;
          try {
            base = baseCanvasUrl(args && args.canvasId);
            link = connectionUrl(args && args.canvasId);
          } catch (error) {
            return { ok: false, text: errorText(error) };
          }
          // 只把不含 hash 的画布地址交给系统浏览器：带 & 的地址过 cmd /c start 会被截断。
          const opened = openInBrowser(base);
          // token 一律掩码，避免完整凭据落进会话记录；完整链接在侧栏「画布」里复制。
          const masked = link.replace(/agentToken=[^&]*/, 'agentToken=' + maskToken(runtime.settings.token));
          return {
            ok: opened,
            text:
              (opened ? '已在系统浏览器打开：' + base : '没能自动打开浏览器，请手动打开：' + base) +
              '\n自动连接用的地址（token 已掩码）：' +
              masked +
              '\n需要带完整 token 的链接时，用 DSH 侧栏「画布」里的「在浏览器打开」或复制 token。',
          };
        },
      },
      {
        name: 'canvas_list_canvases',
        description: '列出可操作的画布：侧栏里保存的画布地址 + 当前已连接的画布会话。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        output: {
          schema: {},
          render: (_args, value) => [{ type: 'text', text: str(value && value.text) }],
        },
        isConcurrencySafe: () => true,
        execute: async () => {
          const lines = [];
          const settings = runtime.settings;
          lines.push('画布地址设置：' + (settings.canvasUrl || '未配置（请在 DSH 侧栏「画布」里粘贴画布地址）'));
          const alive = readySessions();
          lines.push('已连接画布：' + alive.length + ' 个');
          if (!alive.length) lines.push('  （还没有画布连接：在侧栏「画布」里打开画布后会自动连上）');
          for (const session of alive) lines.push(sessionLine(session));
          if (alive.length > 1) {
            lines.push('提示：多张画布同时连接时，在画布工具参数里传 canvasId 指定目标；不传则默认最近连接的那张（' + alive.slice().sort((a, b) => b.connectedAt - a.connectedAt)[0].canvasId + '）。');
          } else if (alive.length === 1) {
            lines.push('提示：当前只有一张画布连接，画布工具可直接调用，无需传 canvasId。');
          } else {
            lines.push('提示：请先在侧栏「画布」里打开一张画布。');
          }
          return { ok: true, text: lines.join('\n') };
        },
      },
      {
        name: 'canvas_import_image_path',
        description:
          '把本机图片文件（PNG/JPEG/WebP/GIF/AVIF）导入画布，生成一个图片节点。' +
          '只需传路径，桥自己读文件转 Base64，不需要在对话里搬运大段数据。' +
          '单张上限 40MB；传多张时用 paths 数组。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: '单张图片的绝对路径（与 paths 二选一）' },
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: '多张图片的绝对路径数组（与 path 二选一）',
            },
            canvasId: {
              type: 'string',
              description: '目标画布 ID。同时连接多张画布时用它指定；只连一张可省略。',
            },
          },
        },
        output: {
          schema: {},
          render: (_args, value) => [{ type: 'text', text: str(value && value.text) }],
        },
        isConcurrencySafe: () => false,
        execute: async (args, exec) => {
          const input = isRecord(args) ? args : {};
          const list = Array.isArray(input.paths)
            ? input.paths.map((one) => str(one).trim()).filter(Boolean)
            : [str(input.path).trim()].filter(Boolean);
          if (!list.length) return { ok: false, text: '请提供图片路径：传 path（单张）或 paths（多张）' };
          const target = { canvasId: str(input.canvasId) };
          const done = [];
          const failed = [];
          for (const one of list) {
            try {
              const result = await importImageByPath(one, exec && exec.signal, target);
              done.push({ path: one, nodeId: str(result && result.nodeId) || undefined, width: result && result.width, height: result && result.height, bytes: result && result.bytes });
            } catch (error) {
              failed.push({ path: one, error: errorText(error) });
            }
          }
          const lines = [];
          lines.push('导入完成：成功 ' + done.length + ' 张，失败 ' + failed.length + ' 张');
          for (const item of done) lines.push('  ✓ ' + item.path + (item.width ? '（' + item.width + '×' + item.height + '）' : '') + (item.bytes ? ' ' + Math.round(item.bytes / 1024) + 'KB' : ''));
          for (const item of failed) lines.push('  ✗ ' + item.path + '：' + item.error);
          return { ok: failed.length === 0, text: lines.join('\n'), imported: done, failed };
        },
      },
    ];
    for (const definition of tools) {
      runtime.metaTools.set(definition.name, definition);
      try {
        ctx.tools.register(definition);
      } catch (error) {
        note('元工具 ' + definition.name + ' 注册失败（已跳过）：' + errorText(error));
      }
    }
  }

  /* --------------------------- 桥 HTTP --------------------------- */

  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,x-canvas-agent-token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,HEAD,DELETE,OPTIONS',
    'Access-Control-Max-Age': '600',
  };

  function sendJson(res, status, body, extra) {
    if (res.writableEnded) return;
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      ...CORS_HEADERS,
      ...(extra || {}),
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      let done = false;
      req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > BODY_LIMIT) {
          done = true;
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (done) return;
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => {
        if (done) return;
        done = true;
        resolve(null);
      });
    });
  }

  function tokenOk(req, url) {
    const expected = str(runtime.settings.token);
    if (!expected) return false;
    const header = str(req.headers['x-canvas-agent-token']);
    if (header && header === expected) return true;
    const query = str(url.searchParams.get('token'));
    return Boolean(query) && query === expected;
  }

  /* ------------------------------------------------------------ 媒体仓库 */
  /*
   * 画布的图片/视频字节只存在浏览器 IndexedDB（localForage）里，节点上只有 storageKey
   * （实测为 image:xxx / generated-video:xxx）和一个会失效的 blob: URL；换了浏览器分区
   * 就全裂。这里按 storageKey 存一份字节，页面可以用 ?token= 直接放进 <img>/<video> 的 src。
   *
   * 落盘：<CANVAS_BRIDGE_HOME>/media/objects/<sha256(key)>.bin
   *       <CANVAS_BRIDGE_HOME>/media/index.json
   * 索引：{ "<storageKey>": { hash, mime, size, updatedAt } }
   * 只写自己的媒体目录，不删用户文件；没有常驻定时器。
   */

  const mediaRootDir = () => path.join(bridgeHome(), 'media');
  const mediaObjectsDir = () => path.join(mediaRootDir(), 'objects');
  const mediaIndexPath = () => path.join(mediaRootDir(), 'index.json');
  const mediaObjectPath = (key) => path.join(mediaObjectsDir(), mediaHash(key) + '.bin');

  /** 目标文件必须落在媒体目录内（纵深防御：文件名已由 sha256 决定，正常不可能越界）。 */
  function mediaInside(file) {
    const root = path.resolve(mediaRootDir());
    const target = path.resolve(file);
    return target === root || target.startsWith(root + path.sep);
  }

  let mediaIndexCache = null;

  /** 读索引（缺失/损坏都不报错，按需重建）。 */
  function mediaIndexLoad() {
    if (mediaIndexCache) return mediaIndexCache;
    mediaIndexCache = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(mediaIndexPath(), 'utf8'));
      if (isRecord(parsed)) {
        for (const key of Object.keys(parsed)) {
          const entry = parsed[key];
          if (!isRecord(entry)) continue;
          const hash = str(entry.hash);
          mediaIndexCache[key] = {
            hash: /^[0-9a-f]{64}$/.test(hash) ? hash : mediaHash(key),
            mime: str(entry.mime) || MEDIA_DEFAULT_MIME,
            size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0,
            updatedAt: str(entry.updatedAt) || new Date(0).toISOString(),
          };
        }
      }
    } catch {
      // 索引不存在或不是合法 JSON：当成空索引，某个 key 被读到时再补
      mediaIndexCache = {};
    }
    return mediaIndexCache;
  }

  function mediaIndexWrite() {
    const file = mediaIndexPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(mediaIndexLoad(), null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(temp, 0o600);
    } catch {
      /* Windows 无 POSIX 语义 */
    }
    fs.renameSync(temp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* 同上 */
    }
  }

  function mediaIndexSet(key, entry) {
    mediaIndexLoad()[key] = entry;
    mediaIndexWrite();
  }

  function mediaIndexRemove(key) {
    const index = mediaIndexLoad();
    if (!Object.hasOwn(index, key)) return;
    delete index[key];
    mediaIndexWrite();
  }

  /**
   * 找到某个 key 对应的文件；索引里没有但 objects 里有文件时按需重建一条。
   * @returns {null | {hash,mime,size,updatedAt,file}}
   */
  function mediaResolve(key) {
    const index = mediaIndexLoad();
    const known = index[key];
    if (known) {
      const file = path.join(mediaObjectsDir(), known.hash + '.bin');
      if (!mediaInside(file)) return null;
      if (!fs.existsSync(file)) return null;
      return { ...known, file };
    }
    const hash = mediaHash(key);
    const file = path.join(mediaObjectsDir(), hash + '.bin');
    if (!mediaInside(file)) return null;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    const rebuilt = {
      hash,
      mime: MEDIA_DEFAULT_MIME,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
    try {
      mediaIndexSet(key, rebuilt);
      log('媒体索引补建一条：key=' + mediaKeyPreview(key));
    } catch (error) {
      log('媒体索引补建写盘失败（不影响读取）：' + errorText(error));
    }
    return { ...rebuilt, file };
  }

  function mediaJson(res, status, body, extra) {
    sendJson(res, status, body, { ...MEDIA_EXPOSE_HEADERS, ...(extra || {}) });
  }

  function rejectMedia(req, res, status, message) {
    mediaJson(res, status, { error: message });
    // 不再需要请求体：排空即可，避免把连接吊死
    if (req.method !== 'GET' && req.method !== 'HEAD' && typeof req.resume === 'function') req.resume();
  }

  /* ---- 列表 ---- */

  function listMedia(req, res) {
    const index = mediaIndexLoad();
    const keys = [];
    for (const key of Object.keys(index)) {
      const entry = index[key];
      const file = path.join(mediaObjectsDir(), entry.hash + '.bin');
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue; // 文件被手工删掉了：列表里不展示幽灵条目
      }
      keys.push({ key, size: stat.size, mime: entry.mime, updatedAt: entry.updatedAt });
    }
    keys.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    mediaJson(res, 200, { keys });
  }

  /* ---- 读取（含 Range） ---- */

  function serveMedia(req, res, key, headOnly) {
    const entry = mediaResolve(key);
    if (!entry) {
      mediaJson(res, 404, {
        error: '媒体不存在',
        hint:
          'key=' +
          mediaKeyPreview(key) +
          ' 还没上传过：让画布页面先 PUT /media/<encodeURIComponent(storageKey)> 传一次字节，或用 GET /media 看已有哪些 key',
      });
      return;
    }
    const size = entry.size;
    const baseHeaders = {
      ...CORS_HEADERS,
      ...MEDIA_EXPOSE_HEADERS,
      'content-type': entry.mime,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    };
    let range = null;
    if (!headOnly) {
      range = parseRangeHeader(req.headers.range, size);
      if (range === 'invalid') {
        const payload = JSON.stringify({
          error:
            'Range 不合法：只支持单段 bytes 范围（bytes=0- / bytes=100-200 / bytes=-100），当前文件 ' +
            size +
            ' 字节；不带 Range 即可取整个文件',
        });
        res.writeHead(416, {
          ...CORS_HEADERS,
          ...MEDIA_EXPOSE_HEADERS,
          'content-type': 'application/json; charset=utf-8',
          'content-range': 'bytes */' + size,
          'content-length': Buffer.byteLength(payload),
          'cache-control': 'no-store',
        });
        res.end(payload);
        return;
      }
    }
    if (headOnly) {
      res.writeHead(200, { ...baseHeaders, 'content-length': size });
      res.end();
      return;
    }
    if (range) {
      const length = range.end - range.start + 1;
      res.writeHead(206, {
        ...baseHeaders,
        'content-length': length,
        'content-range': 'bytes ' + range.start + '-' + range.end + '/' + size,
      });
      const stream = fs.createReadStream(entry.file, { start: range.start, end: range.end });
      stream.on('error', (error) => {
        log('媒体读取失败（key=' + mediaKeyPreview(key) + '）：' + errorText(error));
        try {
          res.destroy();
        } catch {
          /* 已经断开 */
        }
      });
      stream.pipe(res);
      return;
    }
    res.writeHead(200, { ...baseHeaders, 'content-length': size });
    const stream = fs.createReadStream(entry.file);
    stream.on('error', (error) => {
      log('媒体读取失败（key=' + mediaKeyPreview(key) + '）：' + errorText(error));
      try {
        res.destroy();
      } catch {
        /* 已经断开 */
      }
    });
    stream.pipe(res);
  }

  /* ---- 写入（流式） ---- */

  function receiveMedia(req, res, key) {
    const mime = mediaMime(req.headers['content-type']);
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES) {
      // 声明就超限：一个字节都不收
      rejectMedia(req, res, 413, '媒体超过 ' + mediaLimitText() + ' 上限');
      return;
    }
    const directory = mediaObjectsDir();
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      mediaJson(res, 500, {
        error: '媒体目录建不出来（' + directory + '）：' + errorText(error) + '；请检查磁盘空间与目录权限后重试',
      });
      if (typeof req.resume === 'function') req.resume();
      return;
    }
    const hash = mediaHash(key);
    const target = path.join(directory, hash + '.bin');
    if (!mediaInside(target)) {
      rejectMedia(req, res, 400, '存储键解析后不在媒体目录内（key=' + mediaKeyPreview(key) + '），已拒绝');
      return;
    }
    const temp = path.join(directory, hash + '.' + randomUUID() + '.part');
    const out = fs.createWriteStream(temp, { mode: 0o600 });
    let size = 0;
    // writing → ended（收完）→ done（已 commit）；失败走 failed / aborted
    let state = 'writing';

    const dropTemp = () => {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        /* 文件已经不在了 */
      }
    };

    const fail = (status, message) => {
      if (state === 'failed' || state === 'done') return;
      state = 'failed';
      out.destroy(); // 触发 close → 清理半成品
      if (!res.writableEnded) mediaJson(res, status, { error: message });
      // 把剩下的请求体排空，避免连接被吊死（不上头直接 readFile，也不整段进内存）
      if (typeof req.resume === 'function') req.resume();
    };

    const commit = () => {
      state = 'done';
      try {
        fs.renameSync(temp, target);
        try {
          fs.chmodSync(target, 0o600);
        } catch {
          /* Windows 无 POSIX 语义 */
        }
      } catch (error) {
        state = 'failed';
        dropTemp();
        mediaJson(res, 500, {
          error: '媒体落盘失败（' + directory + '）：' + errorText(error) + '；请检查磁盘空间与目录权限后重试',
        });
        return;
      }
      const entry = { hash, mime, size, updatedAt: new Date().toISOString() };
      try {
        mediaIndexSet(key, entry);
      } catch (error) {
        // 索引写失败不影响字节本身，按需重建仍能读到
        log('媒体索引写入失败（字节已落盘）：' + errorText(error));
      }
      log('媒体已保存：key=' + mediaKeyPreview(key) + ' size=' + size + ' mime=' + mime);
      mediaJson(res, 200, { ok: true, key, size, mime });
    };

    out.on('error', (error) => {
      if (state === 'failed' || state === 'done') return;
      fail(500, '媒体写入失败：' + errorText(error) + '；请检查磁盘空间与目录权限后重试');
    });

    out.on('close', () => {
      if (state === 'ended') {
        commit();
        return;
      }
      if (state !== 'done') dropTemp();
    });

    req.on('data', (chunk) => {
      if (state !== 'writing') return;
      size += chunk.length;
      if (size > MEDIA_MAX_BYTES) {
        fail(413, '媒体超过 ' + mediaLimitText() + ' 上限');
        return;
      }
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => {
          if (state === 'writing') req.resume();
        });
      }
    });
    req.on('end', () => {
      if (state !== 'writing') return;
      state = 'ended';
      out.end();
    });
    req.on('aborted', () => {
      if (state !== 'writing') return;
      state = 'aborted';
      out.destroy();
    });
    req.on('error', () => {
      if (state !== 'writing') return;
      state = 'aborted';
      out.destroy();
    });
    res.on('close', () => {
      if (res.writableEnded) return;
      if (state !== 'writing' && state !== 'ended') return;
      state = 'aborted';
      out.destroy();
    });
  }

  /* ---- 删除（幂等） ---- */

  function deleteMedia(req, res, key) {
    const known = mediaIndexLoad()[key];
    const file = known ? path.join(mediaObjectsDir(), known.hash + '.bin') : mediaObjectPath(key);
    if (mediaInside(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        mediaJson(res, 500, {
          error: '媒体删除失败（key=' + mediaKeyPreview(key) + '）：' + errorText(error) + '；请检查目录权限后重试',
        });
        if (typeof req.resume === 'function') req.resume();
        return;
      }
    }
    try {
      mediaIndexRemove(key);
    } catch (error) {
      log('媒体索引删除失败：' + errorText(error));
    }
    log('媒体已删除：key=' + mediaKeyPreview(key));
    mediaJson(res, 200, { ok: true });
  }

  /* ---- 路由 ---- */

  async function routeMedia(req, res, url) {
    let key = '';
    if (url.pathname !== '/media') {
      const raw = url.pathname.slice('/media/'.length);
      try {
        key = decodeURIComponent(raw);
      } catch {
        rejectMedia(req, res, 400, '存储键不是合法的百分号编码：请用 encodeURIComponent(storageKey) 拼 URL');
        return;
      }
      if (!key) {
        rejectMedia(req, res, 400, '缺少 storageKey：单文件请用 /media/<encodeURIComponent(storageKey)>，列目录用 GET /media');
        return;
      }
      if (!mediaKeyValid(key)) {
        rejectMedia(
          req,
          res,
          400,
          '存储键不合法（key 前 12 字符：' + mediaKeyPreview(key) + '）：不能包含 ..、/、\\ 或控制字符，长度上限 ' + MEDIA_KEY_LIMIT + '；请直接用画布节点上的 storageKey',
        );
        return;
      }
    }
    if (!key) {
      if (req.method === 'GET') {
        listMedia(req, res);
        return;
      }
      rejectMedia(req, res, 405, 'GET /media 列出全部媒体；单文件请用 /media/<storageKey>（支持 PUT/GET/HEAD/DELETE）');
      return;
    }
    if (req.method === 'PUT') {
      receiveMedia(req, res, key);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveMedia(req, res, key, req.method === 'HEAD');
      return;
    }
    if (req.method === 'DELETE') {
      deleteMedia(req, res, key);
      return;
    }
    rejectMedia(req, res, 405, '不支持的方法：' + req.method + '（媒体只支持 PUT/GET/HEAD/DELETE）');
  }

  function normalizeTools(raw) {
    const tools = [];
    const seen = new Set();
    if (!Array.isArray(raw)) return tools;
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const toolName = str(entry.name).trim();
      if (!toolName || seen.has(toolName)) continue;
      seen.add(toolName);
      tools.push({
        name: toolName,
        description: str(entry.description),
        inputSchema: isRecord(entry.inputSchema)
          ? entry.inputSchema
          : { type: 'object', properties: {}, additionalProperties: false },
      });
    }
    return tools;
  }

  function handleConnect(body) {
    const clientId = str(body.clientId).trim();
    if (!clientId) {
      throw failure('bad_request', '缺少 clientId：请刷新 DSH 侧栏「画布」面板，页面会自动重新连接');
    }
    const canvasId = str(body.canvasId).trim();
    const tools = normalizeTools(body.tools);
    const session = ensureSession(clientId);
    clearReconnect(session);
    if (canvasId) {
      for (const other of runtime.sessions.values()) {
        if (other !== session && other.canvasId === canvasId) {
          supersede(other, '同一画布出现了新连接，旧连接不再接收调用');
        }
      }
    }
    session.canvasId = canvasId;
    session.tools = tools;
    session.ready = true;
    session.connectedAt = new Date();
    syncDynamicTools(session);
    return { serviceId: runtime.settings.serviceId };
  }

  function attachEvents(req, res, url) {
    const clientId = str(url.searchParams.get('clientId')).trim();
    if (!clientId) {
      sendJson(res, 400, { error: '缺少 clientId：请在 DSH 侧栏「画布」中重新打开画布' });
      return;
    }
    if (res.writableEnded) return;
    res.writeHead(200, {
      ...CORS_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const session = ensureSession(clientId);
    clearReconnect(session);
    // 同一 clientId 重连：先 peacefully 结束旧流
    if (session.res && session.res !== res && !session.res.writableEnded) {
      try {
        session.res.end();
      } catch {
        /* 已断开 */
      }
    }
    session.res = res;
    clearHeartbeat(session);
    session.heartbeat = setInterval(() => {
      if (!session.res || session.res.writableEnded || session.res.destroyed) {
        clearHeartbeat(session);
        return;
      }
      try {
        session.res.write(': ping\n\n');
      } catch {
        clearHeartbeat(session);
      }
    }, HEARTBEAT_MS);
    try {
      res.write(': connected\n\n');
    } catch {
      /* 立刻断了 */
    }
    const onClose = () => {
      // 已经被同一 clientId 的新连接接管：旧流的 close 不能影响新会话
      if (session.res !== res) return;
      session.res = null;
      clearHeartbeat(session);
      // 保留会话 30s 覆盖页面刷新，超时没回来就移除
      clearReconnect(session);
      session.reconnect = setTimeout(() => {
        session.reconnect = null;
        if (session.res) return;
        dropSession(session, '画布页面已断开超过 ' + RECONNECT_GRACE_MS / 1000 + 's，会话已移除');
      }, RECONNECT_GRACE_MS);
    };
    res.on('close', onClose);
    req.on('close', onClose);
  }

  async function handleResult(body) {
    const clientId = str(body.clientId);
    const requestId = str(body.requestId);
    const session = clientId ? runtime.sessions.get(clientId) : undefined;
    const waiter = session ? session.pending.get(requestId) : undefined;
    if (!waiter) {
      // 页面把 409 当作「请求已结束」，不要让它报错
      return { status: 409, body: { error: '请求已结束' } };
    }
    session.pending.delete(requestId);
    if (str(body.error)) {
      waiter.resolve({ ok: false, code: 'canvas_error', message: str(body.error) });
    } else {
      waiter.resolve(body.result === undefined ? { ok: true } : body.result);
    }
    return { status: 200, body: { ok: true } };
  }

  async function handleRpc(body) {
    const method = str(body.method);
    const generation = Number.isFinite(Number(body.generation)) ? Number(body.generation) : 0;
    // 页面用这个响应头推进它自己的 generation；回显原值最安全（永远不大于页面当前值）
    const extra = { 'x-canvas-agent-generation': String(generation) };
    if (method === 'model/list') {
      return { status: 200, body: { data: [], nextCursor: null }, extra };
    }
    return {
      status: 501,
      body: { error: '当前桥只提供画布工具，请在 DSH 中对话' },
      extra,
    };
  }

  async function handleToolsCall(body) {
    const toolName = str(body.name).trim();
    if (!toolName) {
      return {
        result: { ok: false, code: 'bad_request', message: '缺少工具名 name：请传画布工具原名，例如 get_canvas_summary' },
      };
    }
    const args = isRecord(body.arguments) ? body.arguments : {};
    try {
      // 桥自带的元工具（canvas_status / canvas_open / canvas_list_canvases / canvas_import_image_path）
      // 不经过画布页面，直接本地执行；名字可能带或不带 canvas_ 前缀。
      const localTool = runtime.metaTools.get(toolName) || runtime.metaTools.get('canvas_' + toolName.replace(/^canvas_/, ''));
      if (localTool) {
        const value = await localTool.execute(args, { signal: undefined });
        return { result: value };
      }
      const result = await invokeCanvasTool(toolName, args, undefined, {
        clientId: str(body.clientId),
        canvasId: str(body.canvasId),
      });
      return { result };
    } catch (error) {
      return {
        result: {
          ok: false,
          code: str(error && error.canvasCode) || 'canvas_bridge_error',
          message: errorText(error),
        },
      };
    }
  }

  async function handlePanel(request) {
    const json = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    if (request.method !== 'POST') return json(405, { ok: false, error: '只支持 POST' });
    if (request.headers.get(PANEL_HEADER) !== '1') {
      return json(403, { ok: false, error: '请求来源不被允许' });
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(400, { ok: false, error: '请求体不是合法 JSON' });
    }
    const action = str(payload && payload.action);
    try {
      if (action === 'state') return json(200, await panelState(false));
      if (action === 'probe') return json(200, await panelState(true));
      if (action === 'save') {
        const canvasUrl = normalizeCanvasUrl(payload && payload.canvasUrl);
        saveSettings({ canvasUrl });
        probeCache = { at: 0, value: null };
        return json(200, await panelState(true));
      }
      if (action === 'open') {
        return json(200, { url: connectionUrl(payload && payload.canvasId) });
      }
      return json(400, { ok: false, error: '未知 action：' + (action || '(空)') + '（支持 state/save/open/probe）' });
    } catch (error) {
      return json(400, { ok: false, error: errorText(error) });
    }
  }

  async function panelState(force) {
    const settings = runtime.settings;
    const probe = await probeAll(force);
    return {
      bridgeUrl: bridgeUrl(),
      port: runtime.port || settings.port,
      canvasUrl: settings.canvasUrl,
      hasToken: Boolean(settings.token),
      // token 轮换后指纹会变，面板据此重挂 iframe（不可逆，不可用于还原 token）
      tokenFingerprint: settings.token ? createHash('sha256').update(settings.token).digest('hex').slice(0, 12) : '',
      sessions: readySessions().map((session) => ({
        canvasId: session.canvasId,
        connectedAt: session.connectedAt ? new Date(session.connectedAt).toISOString() : '',
        toolCount: session.tools.length,
      })),
      site: probe.site,
      backend: probe.backend,
    };
  }

  async function routeBridge(req, res, url) {
    const pathname = url.pathname;
    if (req.method === 'OPTIONS') {
      // 204 不能带 Content-Length（RFC 7230），预检只需要 CORS 头
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    // 免鉴权端点
    if (req.method === 'GET' && pathname === '/config') {
      sendJson(res, 200, { url: bridgeUrl(), hasToken: Boolean(runtime.settings.token) });
      return;
    }
    if (req.method === 'GET' && pathname === '/bootstrap') {
      if (!ctx.standalone) {
        sendJson(res, 404, { error: '未知的桥端点：' + pathname });
        return;
      }
      const origin = str(req.headers.origin);
      const allowedOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        siteOrigin(),
      ].filter(Boolean);
      if (!allowedOrigins.includes(origin)) {
        sendJson(res, 403, { error: '画布来源不被允许' });
        return;
      }
      sendJson(res, 200, { url: bridgeUrl(), token: runtime.settings.token, standalone: true }, {
        'Access-Control-Allow-Origin': origin,
        'Vary': 'Origin',
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        canvasUrl: runtime.settings.canvasUrl,
        sessions: readySessions().map((session) => ({
          clientId: session.clientId,
          canvasId: session.canvasId,
          connectedAt: session.connectedAt ? new Date(session.connectedAt).toISOString() : '',
        })),
      });
      return;
    }
    if (!tokenOk(req, url)) {
      sendJson(res, 401, { error: '连接凭据无效' });
      return;
    }
    // 媒体中继：PUT/GET/HEAD/DELETE /media[/:key]（token 走 header 或 ?token=）
    if (pathname === '/media' || pathname.startsWith('/media/')) {
      await routeMedia(req, res, url);
      return;
    }
    if (req.method === 'GET' && pathname === '/events') {
      attachEvents(req, res, url);
      return;
    }
    if (req.method === 'GET' && pathname === '/tools') {
      const alive = readySessions().sort((a, b) => b.connectedAt - a.connectedAt);
      // 画布页面提供的工具。清单里去掉页面自用工具，和原生 canvas_* 的暴露范围保持一致。
      const pageTools = alive.length
        ? alive[0].tools.filter((tool) => !EXCLUDED_TOOLS.has(tool.name)).map((tool) => ({ ...tool }))
        : [];
      // 桥自带的元工具必须一起列出来：MCP 的 tools/list 就是从这个端点拉的，
      // 漏掉的话模型看不到 canvas_import_image_path，只能退而求其次乱填别的工具参数。
      const metaTools = [...runtime.metaTools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      }));
      sendJson(res, 200, { tools: [...pageTools, ...metaTools] });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '画布桥不支持这个方法和路径组合：' + req.method + ' ' + pathname });
      return;
    }
    const body = await readBody(req);
    if (!isRecord(body)) {
      sendJson(res, 400, { error: '请求体不是合法 JSON 对象' });
      return;
    }
    if (pathname === '/connect') {
      try {
        sendJson(res, 200, handleConnect(body));
      } catch (error) {
        sendJson(res, 400, { error: errorText(error) });
      }
      return;
    }
    if (pathname === '/result') {
      const outcome = await handleResult(body);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    if (pathname === '/rpc') {
      const outcome = await handleRpc(body);
      sendJson(res, outcome.status, outcome.body, outcome.extra);
      return;
    }
    if (pathname === '/reply') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname === '/tools/call') {
      const outcome = await handleToolsCall(body);
      sendJson(res, 200, outcome);
      return;
    }
    if (pathname === '/disconnect') {
      const clientId = str(body.clientId);
      const session = clientId ? runtime.sessions.get(clientId) : undefined;
      if (session) dropSession(session, '画布页面已断开连接');
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: '未知的桥端点：' + pathname });
  }

  /* --------------------------- 启停 --------------------------- */

  function attachServer(srv) {
    srv.on('clientError', (_error, socket) => {
      try {
        socket.destroy();
      } catch {
        /* 忽略 */
      }
    });
    srv.on('connection', (socket) => {
      runtime.sockets.add(socket);
      socket.on('close', () => runtime.sockets.delete(socket));
    });
    srv.on('error', (error) => log('桥服务出错：' + errorText(error)));
    srv.requestTimeout = 0;
    srv.keepAliveTimeout = 65_000;
    srv.headersTimeout = 66_000;
  }

  function listenOn(port) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        let url;
        try {
          url = new URL(req.url || '/', 'http://127.0.0.1');
        } catch {
          sendJson(res, 400, { error: '请求地址不合法' });
          return;
        }
        routeBridge(req, res, url).catch((error) => {
          log('桥请求处理失败（' + url.pathname + '）：' + errorText(error));
          if (!res.writableEnded) sendJson(res, 500, { error: '画布桥内部错误：' + errorText(error) });
        });
      });
      const onError = (error) => {
        srv.removeListener('listening', onListening);
        try {
          srv.close();
        } catch {
          /* 从没监听成功 */
        }
        reject(error);
      };
      const onListening = () => {
        srv.removeListener('error', onError);
        attachServer(srv);
        resolve(srv);
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
      srv.listen(port, '127.0.0.1');
    });
  }

  async function startServer() {
    const preferred = normalizePort(runtime.settings.port);
    // 首选端口先重试一次：插件重载时旧实例可能还在关闭，抢到 3211 就不会把端口漂到 3212
    const candidates = [preferred, preferred].concat(PORT_CANDIDATES.filter((port) => port !== preferred));
    let lastError = '';
    let attempt = 0;
    for (const port of candidates) {
      attempt += 1;
      if (attempt === 2) await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const srv = await listenOn(port);
        // 启动过程中插件就被卸载了：立刻关掉，别让端口漏在后台
        if (runtime.stopped) {
          try {
            srv.close();
          } catch {
            /* 已关闭 */
          }
          return;
        }
        runtime.server = srv;
        runtime.port = port;
        runtime.startError = '';
        if (port !== runtime.settings.port) {
          try {
            saveSettings({ port });
            log('端口 ' + preferred + ' 被占用，画布桥改用 ' + port + ' 并已写回设置');
          } catch (error) {
            log('画布桥改用端口 ' + port + '，但写回设置失败：' + errorText(error));
          }
        }
        log('画布桥已启动：http://127.0.0.1:' + port + '（token ' + maskToken(runtime.settings.token) + '）');
        return;
      } catch (error) {
        lastError = errorText(error);
        const code = isRecord(error) ? str(error.code) : '';
        if (code !== 'EADDRINUSE' && code !== 'EACCES') break;
      }
    }
    runtime.startError = '端口 3211-3220 都起不来：' + lastError;
    log(runtime.startError);
  }

  function shutdown() {
    runtime.stopped = true;
    for (const session of [...runtime.sessions.values()]) {
      clearReconnect(session);
      clearHeartbeat(session);
      rejectPending(session, 'canvas_stopped', '画布桥已停止：插件被卸载或重载，请重新打开画布面板');
      closeStream(session);
    }
    runtime.sessions.clear();
    disposeDynamic();
    if (runtime.server) {
      const srv = runtime.server;
      runtime.server = null;
      try {
        srv.close();
      } catch {
        /* 已关闭 */
      }
      for (const socket of [...runtime.sockets]) {
        try {
          socket.destroy();
        } catch {
          /* 已断开 */
        }
      }
      runtime.sockets.clear();
    }
    runtime.port = 0;
    log('画布桥已停止');
  }

  /* --------------------------- 装配 --------------------------- */

  // 1) 常驻元工具（单个失败不能拖垮插件）
  registerMetaTools();

  // 2) 侧栏面板路由
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (scope) => {
      scope.connection.fetch.register({
        path: PANEL_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: handlePanel,
      });
    });
  } else if (!ctx.standalone) {
    log('当前宿主没有 ctx.inject，/api/canvas-bridge 面板路由未注册');
  }

  // 3) 卸载/重载时清理（先登记清理，再启动）
  const dispose = () => shutdown();
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => dispose);
  } else if (typeof ctx.on === 'function') {
    ctx.on('dispose', dispose);
  }

  // 4) 起桥
  void startServer();
}
