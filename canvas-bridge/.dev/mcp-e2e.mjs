// 真实链路：假画布页 ↔ 桥 ↔ mcp.js（stdio）↔ 假 MCP 客户端。
// 验证 Codex / Claude Desktop 走的就是这条路。
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(process.env.CANVAS_BRIDGE_HOME || resolve(here, '../../data/storages/canvas-bridge'), 'settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const base = `http://127.0.0.1:${settings.port}`;
const auth = { 'x-canvas-agent-token': settings.token, 'content-type': 'application/json' };
const clientId = randomUUID();

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log('PASS ' + name); }
  else { failed += 1; console.log('FAIL ' + name + ' ' + detail); }
};

// 1) 假画布页上线
const tools = [
  {
    name: 'get_canvas_summary',
    description: '读取当前画布摘要。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
await fetch(base + '/connect', { method: 'POST', headers: auth, body: JSON.stringify({ clientId, canvasId: 'e2e-canvas', tools }) });
const sse = await fetch(`${base}/events?clientId=${clientId}&token=${settings.token}`);
const reader = sse.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let toolEvents = 0;
const pump = (async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const name = (chunk.match(/^event: (.+)$/m) || [])[1];
      const data = (chunk.match(/^data: (.+)$/m) || [])[1];
      if (!data) continue;
      if (name === 'tool') {
        toolEvents += 1;
        const payload = JSON.parse(data);
        await fetch(base + '/result', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            clientId,
            requestId: payload.requestId,
            result: { ok: true, projectId: 'e2e-canvas', via: 'mcp-shim' },
          }),
        });
      }
    }
  }
})();
await new Promise((resolve) => setTimeout(resolve, 200));

// 2) 起 mcp.js
const child = spawn(process.execPath, [join(here, '..', 'mcp.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, CANVAS_BRIDGE_URL: base, CANVAS_BRIDGE_TOKEN: settings.token },
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const waiters = new Map();
function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}
function request(id, method, params) {
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
    setTimeout(() => reject(new Error('timeout ' + method)), 15000);
  });
}
let parsing = '';
child.stdout.on('data', (chunk) => {
  parsing += chunk.toString();
  let idx;
  while ((idx = parsing.indexOf('\n')) >= 0) {
    const line = parsing.slice(0, idx).trim();
    parsing = parsing.slice(idx + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { console.log('非 JSON 输出:', line.slice(0, 200)); continue; }
    if (message.id !== undefined && waiters.has(message.id)) {
      waiters.get(message.id).resolve(message);
      waiters.delete(message.id);
    }
  }
});

const init = await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
check('initialize 返回 serverInfo', init.result?.serverInfo?.name === 'canvas-bridge', JSON.stringify(init.result));
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const list = await request(2, 'tools/list', {});
const names = (list.result?.tools || []).map((tool) => tool.name);
check('tools/list 原样返回画布工具名', names.includes('get_canvas_summary'), JSON.stringify(names));

const call = await request(3, 'tools/call', { name: 'get_canvas_summary', arguments: {} });
const text = call.result?.content?.[0]?.text || '';
check('tools/call 往返成功', call.result?.isError === false && /e2e-canvas/.test(text), text.slice(0, 200));
check('每次调用都回到页面', toolEvents >= 1, String(toolEvents));

const missing = await request(4, 'tools/call', { name: 'not_a_tool', arguments: {} });
check('未知工具 isError', missing.result?.isError === true, JSON.stringify(missing.result));

const bad = await request(5, 'tools/call', { name: 'get_canvas_summary', arguments: { x: 1 } });
check('额外参数不致命', bad.result?.isError === false, JSON.stringify(bad.result).slice(0, 160));

// 3) 停桥后会话消失：先断页面，再调一次
await fetch(base + '/disconnect', { method: 'POST', headers: auth, body: JSON.stringify({ clientId }) }).catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 200));
const offline = await request(6, 'tools/call', { name: 'get_canvas_summary', arguments: {} });
check('画布断开后 isError + 可纠正文案', offline.result?.isError === true && /画布/.test(offline.result?.content?.[0]?.text || ''), JSON.stringify(offline.result).slice(0, 220));

check('stdout 全是合法 JSON', !/非 JSON/.test(stdout) && stdout.length > 0, String(stdout.length));
check('stderr 没有明文 token', !stderr.includes(settings.token), stderr.slice(0, 120));

child.kill();
await Promise.resolve(pump).catch(() => {});
await sse.body.cancel().catch(() => {});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
