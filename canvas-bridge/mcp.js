#!/usr/bin/env node
/**
 * canvas-bridge 的 stdio MCP 服务端（给 Codex / Claude Desktop 用）。
 *
 * 零依赖：stdin/stdout 逐行 JSON-RPC 2.0，工具全部转发到项目里的独立画布桥
 * （GET /tools、POST /tools/call）。stdout 只允许出现 JSON-RPC 报文，诊断一律走 stderr。
 *
 * 配置来源优先级：环境变量 CANVAS_BRIDGE_URL / CANVAS_BRIDGE_TOKEN > 项目数据目录的 settings.json。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 3211;
const SERVER_INFO = { name: 'canvas-bridge', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';
const LIST_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 200_000;
const TEXT_LIMIT = 20_000;
/** 工具清单轮询间隔：兼顾及时发现画布连上，又不至于打得太频繁。 */
const TOOL_WATCH_MS = 5_000;

/* ------------------------------------------------------------------ 基础 */

const str = (value) => (typeof value === 'string' ? value : '');

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function errorText(error) {
  if (error instanceof Error && error.message) return error.message;
  const text = str(error);
  return text || '未知错误';
}

/** token 只允许以掩码形式出现在 stderr。 */
function maskToken(token) {
  const value = str(token);
  if (!value) return '(未配置)';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

function diag(message) {
  try {
    process.stderr.write('[canvas-bridge-mcp] ' + message + '\n');
  } catch {
    /* stderr 不可用就算了 */
  }
}

/* ------------------------------------------------------------- 配置读取 */

/** 读取项目目录里的本机桥设置，不依赖 DeepSeek Harness 的用户目录。 */
function settingsCandidates() {
  const home = process.env.CANVAS_BRIDGE_HOME || path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), '../data/storages/canvas-bridge');
  return [path.join(home, 'settings.json')];
}

function readSettings() {
  for (const file of settingsCandidates()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isRecord(parsed)) return parsed;
    } catch {
      /* 试下一个位置 */
    }
  }
  return {};
}

function normalizeEndpoint(raw) {
  const value = str(raw).trim().replace(/\/+$/, '');
  if (!value) return 'http://127.0.0.1:' + DEFAULT_PORT;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('协议不对');
    return url.origin + (url.pathname === '/' ? '' : url.pathname);
  } catch {
    diag('CANVAS_BRIDGE_URL 不是合法地址（' + value + '），回退到 http://127.0.0.1:' + DEFAULT_PORT);
    return 'http://127.0.0.1:' + DEFAULT_PORT;
  }
}

const configuredUrl = str(process.env.CANVAS_BRIDGE_URL).trim();
const configuredToken = str(process.env.CANVAS_BRIDGE_TOKEN).trim();
let endpoint = '';
let token = '';

function refreshConfig() {
  const current = readSettings();
  const port = Number(current.port);
  if (!configuredUrl) endpoint = normalizeEndpoint('http://127.0.0.1:' + (Number.isInteger(port) && port >= 3211 && port <= 3220 ? port : DEFAULT_PORT));
  token = configuredToken || str(current.token).trim();
}

refreshConfig();

/* --------------------------------------------------------------- 桥调用 */

class BridgeUnreachable extends Error {}

async function bridgeFetch(pathname, options) {
  const settingsLocal = options || {};
  refreshConfig();
  let response;
  try {
    response = await fetch(endpoint + pathname, {
      method: settingsLocal.method || 'GET',
      headers: Object.assign(
        { 'x-canvas-agent-token': token },
        settingsLocal.body === undefined ? {} : { 'content-type': 'application/json' },
      ),
      body: settingsLocal.body === undefined ? undefined : JSON.stringify(settingsLocal.body),
      signal: AbortSignal.timeout(settingsLocal.timeoutMs || LIST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BridgeUnreachable(errorText(error));
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

function offlineText(reason) {
  return (
    '画布桥未运行，请先启动项目里的画布桥（桥地址 ' +
    endpoint +
    '）。' +
    (reason ? '原因：' + reason + '。' : '') +
    '启动后打开画布，工具才会出现。'
  );
}

async function listTools() {
  let outcome;
  try {
    outcome = await bridgeFetch('/tools');
  } catch (error) {
    throw new BridgeUnreachable(offlineText(errorText(error)));
  }
  if (!outcome.ok) {
    const reason = outcome.status === 401 ? '连接凭据无效（Token 与项目设置不一致）' : 'HTTP ' + outcome.status;
    throw new BridgeUnreachable(offlineText(reason));
  }
  const tools = outcome.data && Array.isArray(outcome.data.tools) ? outcome.data.tools : [];
  // 原样返回画布的工具名（不加前缀），兼容既有 prompt / skill
  // 同时记下指纹，作为后续轮询比对"清单有没有变"的基准
  if (tools.length) lastToolFingerprint = fingerprintTools(tools);
  return { tools };
}

function resultText(result) {
  if (result === undefined || result === null) return '画布没有返回结果（可能页面已断开）：请重新调用，或先在 DSH 侧栏「画布」里刷新面板。';
  if (typeof result !== 'object') return String(result);
  if (result.ok === false) {
    const reason = str(result.message) || str(result.code) || '画布工具执行失败';
    const rest = Object.keys(result).filter((key) => !['ok', 'code', 'message'].includes(key));
    const extra = rest.length ? '\n' + JSON.stringify(result, null, 2) : '';
    return '失败：' + reason + extra;
  }
  let json = '';
  try {
    json = JSON.stringify(result, null, 2);
  } catch {
    json = String(result);
  }
  return json.length > TEXT_LIMIT ? json.slice(0, TEXT_LIMIT) + '\n…（已截断）' : json;
}

async function callTool(params) {
  const toolName = str(params && params.name).trim();
  const args = isRecord(params && params.arguments) ? params.arguments : {};
  if (!toolName) {
    return {
      content: [{ type: 'text', text: '缺少工具名 name：请先用 tools/list 看画布有哪些工具，再传工具原名。' }],
      isError: true,
    };
  }
  let outcome;
  try {
    outcome = await bridgeFetch('/tools/call', {
      method: 'POST',
      body: { name: toolName, arguments: args },
      timeoutMs: CALL_TIMEOUT_MS,
    });
  } catch (error) {
    return { content: [{ type: 'text', text: offlineText(errorText(error)) }], isError: true };
  }
  if (!outcome.ok) {
    const reason =
      outcome.status === 401
        ? '连接凭据无效（Token 与项目设置不一致）'
        : str(outcome.data && outcome.data.error) || 'HTTP ' + outcome.status;
    return {
      content: [
        {
          type: 'text',
          text: '画布桥拒绝了这次调用：' + reason + '。请确认项目里的画布桥已启动且画布已连接。',
        },
      ],
      isError: true,
    };
  }
  const result = outcome.data ? outcome.data.result : undefined;
  return {
    content: [{ type: 'text', text: resultText(result) }],
    isError: !(result && result.ok),
  };
}

/* ------------------------------------------------------------- JSON-RPC */

function send(message) {
  try {
    process.stdout.write(JSON.stringify(message) + '\n');
  } catch (error) {
    diag('写 stdout 失败：' + errorText(error));
  }
}

function rpcError(code, message) {
  return { code, message };
}

/* ------------------------------------------------------- 工具清单变化通知 */

/**
 * 画布是"后连上"的：MCP 进程通常比画布先启动，那一刻 /tools 里可能只有元工具。
 * initialize 里声明了 listChanged: true，就必须真的发通知，
 * 否则客户端会一直用启动时的旧清单，误以为画布没有节点类 / 生成类工具。
 */
let lastToolFingerprint = '';
let toolWatchTimer = null;

function fingerprintTools(tools) {
  return tools
    .map((tool) => str(tool && tool.name))
    .filter(Boolean)
    .sort()
    .join(',');
}

function notifyToolListChanged() {
  send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
}

async function pollToolList() {
  let outcome;
  try {
    outcome = await bridgeFetch('/tools', { timeoutMs: TOOL_WATCH_MS });
  } catch {
    return; // 桥暂时不可达：静默跳过，下一轮再试
  }
  if (!outcome.ok) return;
  const tools = outcome.data && Array.isArray(outcome.data.tools) ? outcome.data.tools : [];
  const next = fingerprintTools(tools);
  // 空清单不算"变化"，避免画布断开时把客户端刷成空列表
  if (!next || next === lastToolFingerprint) return;
  lastToolFingerprint = next;
  diag('工具清单已变化（' + tools.length + ' 个），通知客户端重新拉取');
  notifyToolListChanged();
}

function startToolWatch() {
  if (toolWatchTimer) return;
  toolWatchTimer = setInterval(() => {
    void pollToolList().catch(() => {});
  }, TOOL_WATCH_MS);
  // 不让这个定时器拖住进程退出
  if (typeof toolWatchTimer.unref === 'function') toolWatchTimer.unref();
}

function stopToolWatch() {
  if (!toolWatchTimer) return;
  clearInterval(toolWatchTimer);
  toolWatchTimer = null;
}

async function handleRequest(method, params) {
  switch (method) {
    case 'initialize':
      // 先把当前指纹记下来，之后的差异才算"变化"
      await listTools().catch(() => {});
      startToolWatch();
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: SERVER_INFO,
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return {};
    case 'ping':
      return {};
    case 'tools/list':
      return listTools();
    case 'tools/call':
      return callTool(params);
    default:
      throw Object.assign(new Error('不支持的方法：' + method), { rpcCode: -32601 });
  }
}

async function handleMessage(message) {
  if (!isRecord(message)) {
    send({ jsonrpc: '2.0', id: null, error: rpcError(-32600, '无效的 JSON-RPC 报文：需要对象') });
    return;
  }
  const hasId = message.id !== undefined && message.id !== null;
  const method = str(message.method);
  if (!method) {
    // 客户端回报的 error 或响应报文，本服务端没有 outgoing 请求，忽略
    if (hasId) send({ jsonrpc: '2.0', id: message.id, error: rpcError(-32600, '无效的 JSON-RPC 报文：缺少 method') });
    return;
  }
  try {
    const result = await handleRequest(method, message.params || {});
    if (hasId) send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    const code = isRecord(error) && Number.isInteger(error.rpcCode) ? error.rpcCode : -32603;
    if (method.startsWith('notifications/')) {
      diag('通知 ' + method + ' 处理失败：' + errorText(error));
      return;
    }
    if (hasId) send({ jsonrpc: '2.0', id: message.id, error: rpcError(code, errorText(error)) });
    else diag('请求 ' + method + ' 处理失败：' + errorText(error));
  }
}

async function handleLine(line) {
  const text = line.trim();
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: rpcError(-32700, '无法解析 JSON-RPC 报文：不是合法 JSON') });
    return;
  }
  if (Array.isArray(parsed)) {
    for (const message of parsed) {
      // 顺序处理，保证响应顺序与请求一致
      // eslint-disable-next-line no-await-in-loop
      await handleMessage(message);
    }
    return;
  }
  await handleMessage(parsed);
}

function main() {
  diag('启动：桥地址 ' + endpoint + '，token ' + maskToken(token) + '（项目桥设置 ' + settingsCandidates()[0] + '）');
  if (!token) {
    diag('没有找到 Token：请先启动项目里的桥服务，或用 CANVAS_BRIDGE_TOKEN 指定');
  }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    chain = chain.then(() => handleLine(line)).catch((error) => diag('处理报文失败：' + errorText(error)));
  });
  rl.on('close', () => {
    chain.finally(() => {
      stopToolWatch();
      diag('stdin 已关闭，退出');
      process.exit(0);
    });
  });
}

process.on('uncaughtException', (error) => {
  diag('未捕获异常：' + errorText(error));
});
process.on('unhandledRejection', (error) => {
  diag('未处理的 Promise 拒绝：' + errorText(error));
});
process.on('SIGTERM', () => {
  stopToolWatch();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopToolWatch();
  process.exit(0);
});

main();
