// 假画布页面：验证 canvas-bridge 的 /connect、SSE tool 事件、/result、/tools/call 往返。
// 用法：node fake-page.mjs [port]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const settingsPath = join(process.env.CANVAS_BRIDGE_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '../../data/storages/canvas-bridge'), 'settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const port = Number(process.argv[2] || settings.port);
const base = `http://127.0.0.1:${port}`;
const token = settings.token;
const clientId = randomUUID();

const auth = { 'x-canvas-agent-token': token, 'content-type': 'application/json' };
let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${detail}`); }
}

// 1. /config 免鉴权
{
  const res = await fetch(base + '/config');
  const body = await res.json();
  check('GET /config', res.ok && body.url === base && body.hasToken === true, JSON.stringify(body));
}

// 2. 错误 token 401
{
  const res = await fetch(base + '/tools', { headers: { 'x-canvas-agent-token': 'wrong' } });
  check('GET /tools 错误 token → 401', res.status === 401, String(res.status));
}

// 3. 未连接时 /tools 为空
{
  const res = await fetch(base + '/tools', { headers: auth });
  const body = await res.json();
  check('未连接时 /tools 返回空', res.ok && Array.isArray(body.tools) && body.tools.length === 0, JSON.stringify(body));
}

// 4. 未连接时 /tools/call 给出可纠正的错误
{
  const res = await fetch(base + '/tools/call', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'get_canvas_summary', arguments: {} }) });
  const body = await res.json().catch(() => ({}));
  check('未连接时 /tools/call 返回可纠正错误', res.ok && body.result?.ok === false && body.result?.code === 'canvas_not_connected', JSON.stringify(body));
}

// 5. /connect
const tools = [
  {
    name: 'get_media_task_status',
    description: '读取生成任务状态。',
    inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'], additionalProperties: false },
  },
  {
    name: 'get_canvas_summary',
    description: '读取当前画布摘要。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_text_node',
    description: '创建文本节点。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 80 },
        content: { type: 'string' },
        sourceNodeIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  },
];
{
  const res = await fetch(base + '/connect', { method: 'POST', headers: auth, body: JSON.stringify({ clientId, canvasId: 'fake-canvas', tools }) });
  const body = await res.json();
  check('POST /connect 返回 serviceId', res.ok && typeof body.serviceId === 'string' && body.serviceId.length > 0, JSON.stringify(body));
}

// 6. SSE 订阅
const controller = new AbortController();
const events = [];
const sse = await fetch(`${base}/events?clientId=${clientId}&token=${token}`, { signal: controller.signal });
check('GET /events 返回 event-stream', sse.ok && String(sse.headers.get('content-type')).includes('text/event-stream'), sse.headers.get('content-type') || '');

const pending = new Map();
const reader = sse.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pump = (async () => {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const name = (chunk.match(/^event: (.+)$/m) || [])[1] || 'message';
        const data = (chunk.match(/^data: (.+)$/m) || [])[1];
        if (!data) continue;
        const payload = JSON.parse(data);
        events.push({ name, payload });
        if (name === 'tool' && payload.name === 'get_media_task_status') {
          // 故意不回，用于验证超时分支
          continue;
        }
        if (name === 'tool') {
          // 模拟页面执行并回传
          const result = payload.name === 'get_canvas_summary'
            ? { ok: true, projectId: 'fake-canvas', nodes: [], note: 'fake page' }
            : { ok: true, nodeId: 'node-' + payload.requestId.slice(0, 6), title: payload.arguments?.title };
          await fetch(base + '/result', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ clientId, requestId: payload.requestId, result }),
          });
          pending.get(payload.requestId)?.resolve(result);
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) console.log('SSE error', error.message);
  }
})();

await new Promise((resolve) => setTimeout(resolve, 300));

// 7. /tools 有工具，且 schema 保留
{
  const res = await fetch(base + '/tools', { headers: auth });
  const body = await res.json();
  const names = body.tools.map((tool) => tool.name);
  check('连接后 /tools 有 3 个工具', names.length === 3 && names.includes('create_text_node'), JSON.stringify(names));
}

// 8. /tools/call 往返
{
  const started = Date.now();
  const res = await fetch(base + '/tools/call', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'get_canvas_summary', arguments: {} }) });
  const body = await res.json();
  check('POST /tools/call 往返成功', res.ok && body.result?.ok === true && body.result?.note === 'fake page', JSON.stringify(body));
  console.log('  roundtrip ms =', Date.now() - started);
}

// 9. 写工具参数原样透传
{
  const res = await fetch(base + '/tools/call', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'create_text_node', arguments: { title: '标题', content: '正文' } }) });
  const body = await res.json();
  const sent = events.filter((event) => event.name === 'tool').at(-1)?.payload;
  check('参数原样透传到页面', res.ok && sent?.arguments?.title === '标题' && sent?.arguments?.content === '正文', JSON.stringify(sent?.arguments));
}

// 10. /rpc model/list
{
  const res = await fetch(base + '/rpc', { method: 'POST', headers: auth, body: JSON.stringify({ method: 'model/list', params: {} }) });
  const body = await res.json();
  check('POST /rpc model/list', res.ok && Array.isArray(body.data) && body.nextCursor === null, JSON.stringify(body));
}

// 11. 超时分支：让页面不回 result
{
  const call = fetch(base + '/tools/call', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'get_media_task_status', arguments: { nodeId: 'n1' } }) });
  // 找到这次请求的 requestId 后直接不回
  await new Promise((resolve) => setTimeout(resolve, 100));
  const lastTool = events.filter((event) => event.name === 'tool').at(-1);
  const res = await call;
  const body = await res.json().catch(() => ({}));
  check('超时返回可读错误', body.result?.ok === false && body.result?.code === 'canvas_timeout', JSON.stringify(body));
  check('超时后下发 tool-cancel', events.some((event) => event.name === 'tool-cancel' && event.payload.requestId === lastTool?.payload?.requestId), JSON.stringify(events.filter((e) => e.name === 'tool-cancel').at(-1) || null));
}

controller.abort();
await pump.catch(() => {});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
