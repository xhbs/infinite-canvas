# canvas-bridge 插件施工规范（v1）

目标：把 Infinite Canvas 画布接进 DSH —— DSH 侧栏内嵌画布页、原生工具控制画布，同一套桥同时给
Codex / Claude Desktop 用 MCP 控制**同一个**画布。

本文件是唯一契约。两个实施者按「文件归属」各写各的，不要改对方的文件，不要安装插件，不要改
`~/.dsh/profiles/**` 或 `settings.yaml`。

---

## 0. 背景事实（已核对源码，不要再自行猜测）

画布仓库：`D:\software\infinite-canvas`。

- 画布页面是 Next.js 应用，默认 `http://localhost:3000`，画布路由 `/canvas/<id>`。
- 画布页内置一个「MCP 桥客户端」：读 URL hash 的 `agentUrl`/`agentToken` 或 localStorage
  `canvas-codex-connection`，向桥发起 `POST /connect`（携带画布全部工具 schema），并建立
  `GET /events` 的 SSE 长连接；桥通过 SSE 下发 `tool` 事件，页面执行后 `POST /result` 回传。
  相关源码：`web/src/services/api/codex-agent.ts`、`web/src/app/(user)/canvas/agent/use-codex-agent.ts`。
- 页面连接后会调用一次 `POST /rpc` 的 `model/list`（画布内 Codex 用）。必须返回
  `{ "data": [], "nextCursor": null }`，否则页面显示连接错误。
- 桥协议（页面已实现，我们只实现服务端）：`GET /config`、`POST /connect`、`GET /events`、
  `POST /result`、`POST /rpc`、`POST /reply`、`POST /tools`、`POST /tools/call`。
- 页面发来的工具条目形状：`{ name, description, inputSchema }`，inputSchema 是 JSON Schema
  （含 `maxLength`/`minItems`/`minimum` 等 DSH 不支持的关键字）。
- 画布工具结果形状：`{ ok: boolean, code?: string, message?: string, ...其他字段 }`。
- 页面是唯一执行端（节点状态、blob 图片都在浏览器里）。桥不落库、不缓存画布状态。

DSH 插件事实（`F:\workspace\dsh\storyboard-plugin` 是可运行范例，可直接参考写法）：

- 包结构：`package.json`（`dsh.bundle.patch` + 可选 `dsh.client`）、`cordis.patch.yml`、`index.js`（宿主）、
  `client.js`（浏览器端）、`locale/*.json`、`icon.svg`。
- 宿主插件：`export const inject = ['tools']`，`export function apply(ctx)`，用 `ctx.tools.register(def)`；
  需要 HTTP 路由时 `ctx.inject(['connection'], scope => scope.connection.fetch.register({ path, methods, requestBody, fetch }))`。
- 工具定义形状（纯 JS 对象，不需要 defineTool）：
  ```js
  ctx.tools.register({
    name: 'canvas_status',
    description: '...',
    parameters: { type: 'object', additionalProperties: false, required: [...], properties: {...} },
    output: { schema: {}, render: (args, value) => [{ type: 'text', text: String(value.text ?? '') }] },
    isConcurrencySafe: (args) => true,
    async execute(args, exec) { /* exec.signal 是 AbortSignal */ return { ok: true, text: '...' }; },
  })
  ```
  `parameters` 只支持这些关键字：`type/oneOf/properties/required/additionalProperties/items/enum/const`
  ＋ `description/title/default/examples`；`additionalProperties` 必须是布尔；`enum` 只能是标量。
  **其他关键字会导致注册抛错**，必须清洗。
  `output.schema` 传 `{}`（无约束 JSON）。`render` 返回 `[{type:'text', text}]`。
- 浏览器端模块格式：`window.__ModuleLoader__.load({ id: '<包名>', factory(require) { ... return { inject: [...], apply(ctx) {...} } } })`。
  `require('react')` 可用。用 `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id, order, label }, Icon))`
  注册侧栏图标，用 `ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key }, Panel))` 注册全画面板。
  样式通过 `<style>` 元素写在面板里，颜色用 `var(--dsw-alias-*)` 主题变量。
- 客户端访问宿主：同源 `fetch('/api/canvas-bridge', { method:'POST', headers:{'content-type':'application/json','x-canvas-bridge':'1'}, body })`。

---

## 1. 文件归属

| 文件 | 负责人 | 说明 |
|---|---|---|
| `index.js` | A（宿主） | 桥服务 + 原生工具 + 宿主路由 |
| `mcp.js` | A（宿主） | 零依赖 stdio MCP 服务端（给 Codex / Claude） |
| `client.js` | B（前端） | 侧栏面板：内嵌画布 iframe + 设置 + 状态 |
| `package.json` | B | 含 `exports`、`files`、`dsh.client` |
| `cordis.patch.yml` | B | 插入一行 `canvas-bridge` |
| `locale/zh.json`、`locale/en.json`、`icon.svg` | B | 展示元数据 |

包目录：`D:\software\infinite-canvas\canvas-bridge`。包名 `@local/canvas-bridge`，`"type": "module"`，无第三方依赖。

---

## 2. 宿主插件 `index.js`

### 2.1 设置（自管，不写 DSH 配置）

standalone 服务文件为 `data/storages/canvas-bridge/settings.json`；DSH 插件宿主继续使用 DSH 自己的 storage。可用 `CANVAS_BRIDGE_HOME` 指定桥实例的数据目录，权限 0600。

```json
{ "port": 3211, "token": "<64 hex>", "canvasUrl": "", "serviceId": "<uuid>" }
```

- 首次启动生成 `token`（32 字节 hex）与 `serviceId`（uuid），原子写（tmp + rename）。
- 端口默认 3211；`EADDRINUSE` 时依次尝试 3212..3220 并把实际端口写回设置。
- 服务只监听 `127.0.0.1`。
- `bridge-start.mjs` 提供独立入口，桌面一键启动脚本负责启动与重启服务。
- DSH 插件宿主卸载/重载时关闭服务（`ctx.effect` 返回清理函数）。

### 2.2 桥 HTTP 服务（给画布页与 MCP）

所有响应 `application/json`（`/events` 除外），统一 CORS：
`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: content-type,x-canvas-agent-token`，
`Access-Control-Allow-Methods: GET,POST,OPTIONS`、`Access-Control-Max-Age: 600`。
`OPTIONS` 一律 204。鉴权：`x-canvas-agent-token` header 或 `?token=` 查询参数，与设置里的 token 全等；
`GET /config` 与 `GET /health` 免鉴权。token 错误返回 401 `{"error":"连接凭据无效"}`。

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /config` | — | `{"url":"http://127.0.0.1:3211","hasToken":true}` |
| `GET /bootstrap` | 仅 standalone 服务，Origin 必须是本地画布站点 | 返回桥 URL 和连接 Token，响应仅允许该画布 Origin 读取 |
| `GET /health` | — | `{"ok":true,"canvasUrl":...,"sessions":[{clientId,canvasId,connectedAt,canvasTitle?}]}` |
| `POST /connect` | `{clientId, canvasId, tools:[{name,description,inputSchema}]}` | `{"serviceId":"<uuid>"}` |
| `GET /events?clientId&token` | — | SSE，事件见下 |
| `POST /result` | `{clientId, requestId, result?, error?}` | `{"ok":true}`（未知 requestId 返回 409 `{"error":"请求已结束"}`） |
| `GET /tools` | — | `{"tools":[{"name","description","inputSchema"}]}`（已连接画布的工具，未连接返回 `{"tools":[]}`） |
| `POST /tools/call` | `{name, arguments, clientId?}` | `{"result": <画布原始结果>}` |
| `POST /rpc` | `{method, params}` | `model/list` → `{"data":[],"nextCursor":null}`；其他 → `{"error":"当前桥只提供画布工具，请在 DSH 中对话"}` |
| `POST /reply` | `{...}` | `{"ok":true}` |
| `POST /disconnect` | `{clientId}` | `{"ok":true}` |

SSE 事件（`event: <name>\ndata: <json>\n\n`）：

- `tool`：`{requestId, source:"external", generation:0, name, arguments}` —— 页面执行后回 `/result`。
- `tool-cancel`：`{requestId}` —— 桥超时后要求页面放弃。

每 15s 发一次注释心跳 `: ping\n\n`。SSE 关闭后保留会话 30s（覆盖刷新），超时未重连则移除。

### 2.3 会话与调用

- `sessions: Map<clientId, {clientId, canvasId, tools, res, connectedAt, queue}>`。
- 同一 `canvasId` 出现新连接时，旧会话标记 `superseded` 并**不再接收调用**（日志提示），新会话生效。
- 目标选择：显式 `canvasId`/`clientId` > 唯一已连接会话 > 报错
  `画布未连接：请在 DSH 侧栏「画布」中打开画布；当前已连接 N 个，请指定 canvasId`。
- 并发：**每个会话一条 FIFO 队列**，所有调用串行（DSH 与 Codex 不会交叉写节点）。排队超过 30s 直接失败
  `画布正忙，请稍后重试`。
- 每次调用：`requestId = randomUUID()`，通过 SSE 发 `tool`，等待 `/result` 或超时；超时发 `tool-cancel` 并抛
  `画布未在 <n>s 内返回结果（<toolName>）`。
- 超时：默认 60s；`generate_image`/`edit_image`/`generate_video`/`generate_audio`/`import_image_data` 180s；
  `get_media_task_status`/`get_generation_task` 30s；随 `exec.signal` 中止。

### 2.4 原生工具

**常驻元工具（启动即注册，永不消失）**

1. `canvas_status` —— 返回桥地址、端口、画布地址设置、站点/后端可用性、已连接会话列表（canvasId、连接时间、
   工具数）、最近一次调用。`output.text` 是人类可读摘要。
2. `canvas_open` —— 在系统浏览器打开画布（`process.platform === 'win32'` 用
   `spawn('cmd', ['/c','start','','<url>'], {detached:true, stdio:'ignore'})`，其他平台 `open`/`xdg-open`），
   并返回带 `#agentUrl&agentToken` 的地址提示。参数：`{ canvasId?: string }`（缺省用设置里的 canvasUrl）。
3. `canvas_list_canvases` —— 读设置里的 `canvasUrl` 与当前会话，列出可操作的画布（v1 只有配置项 + 已连接会话）。

**动态工具**：`/connect` 收到工具清单后，把除 `set_agent_state`、`read_skill_file` 之外的每个工具注册为
`canvas_<原名>`（如 `canvas_generate_image`）。重新连接时先 dispose 旧的再注册新的。
`description` 用页面给的原文，前缀 `[画布] `。参数用清洗后的 schema（见 §2.5）。
`execute` 调 §2.3 的调用逻辑，返回画布原始结果；`render` 生成紧凑文本：

- `ok === false`：`失败：<message 或 code>`
- 否则：`完成 <toolName>` + `JSON.stringify(result)` 截断到 4000 字符。

工具参数的 `name` 冲突时（已注册）先 dispose 再注册。

### 2.5 schema 清洗（必须）

递归遍历页面给的 inputSchema，只保留 `type/oneOf/properties/required/additionalProperties/items/enum/const/description/title`：
删掉 `maxLength/minLength/maxItems/minItems/minimum/maximum/pattern/format/default/examples/...`；
`additionalProperties` 非布尔则删；`enum` 出现在非标量类型上则删；`required` 里不在 `properties` 的键删掉；
根节点强制 `type: 'object'`。清洗后若为空对象则退化为 `{ type: 'object', additionalProperties: true }`。

### 2.6 宿主路由（给侧栏面板）

`ctx.inject(['connection'], scope => scope.connection.fetch.register({ path: '/api/canvas-bridge', methods: ['POST'], requestBody: 'buffered', fetch: handler }))`。

- 必须校验 header `x-canvas-bridge: 1`，否则 403。
- `GET` 语义用 POST body `{action}` 表达：

| action | 入参 | 返回 |
|---|---|---|
| `state` | — | `{bridgeUrl, port, canvasUrl, hasToken, sessions:[{canvasId,connectedAt,toolCount}], site:{ok,url,error?}, backend:{ok,error?}}` |
| `save` | `{canvasUrl}` | 校验为 `http://localhost:<port>/canvas/<id>` 或 `http://127.0.0.1:<port>/canvas/<id>`，保存并返回 `state` |
| `open` | `{canvasId?}` | 组装 `canvasUrl` + `#agentUrl=<bridgeUrl>&agentToken=<token>`，返回 `{url}`（面板自己塞 iframe；本动作不打开系统浏览器） |
| `probe` | — | 重新探测站点/后端，返回 `state` |

站点探测：`GET <siteOrigin>/canvas` 超时 3s（只看 HTTP 状态）。后端探测：`GET <siteOrigin>/api/health` 超时 3s。

---

## 3. stdio MCP `mcp.js`（给 Codex / Claude Desktop）

零依赖，`node mcp.js`，stdin/stdout 逐行 JSON-RPC 2.0。配置来源优先级：环境变量
`CANVAS_BRIDGE_URL`/`CANVAS_BRIDGE_TOKEN` > 项目 `data/storages/canvas-bridge/settings.json`。

- `initialize` → `{protocolVersion:"2024-11-05", capabilities:{tools:{listChanged:true}}, serverInfo:{name:"canvas-bridge", version:"1.0.0"}}`
- `notifications/initialized` → 无响应
- `tools/list` → 桥 `GET /tools`，原样返回 `{tools:[{name,description,inputSchema}]}`（**不加前缀**，保持
  `get_canvas_summary` 等原名，兼容既有 prompt/skill）
- `tools/call` → 桥 `POST /tools/call`，成功返回 `{content:[{type:"text",text:<JSON 或 message>}], isError:!result.ok}`
- `ping` → `{}`；未知方法 → `-32601`
- 桥不可达：`tools/call` 返回 `isError:true`，文本说明「画布桥未运行，请先启动项目里的画布桥」。
- stderr 只打诊断日志，stdout 绝不混入非 JSON 内容。

---

## 4. 侧栏面板 `client.js`

`sidebar.panellist` 图标（id `canvas-bridge`，label `画布`，order 21）+ `main` 面板。

面板状态机：

1. **未配置**：显示输入框「粘贴画布地址」，占位符 `http://localhost:3000/canvas/xxxx`，按钮「保存并打开」。
   保存走 `action:'save'`，成功后进入 2。
2. **已配置**：整块 iframe 铺满（`border:0;width:100%;height:100%`），`src = <canvasUrl>#agentUrl=<bridgeUrl>&agentToken=<token>`
   （已有 hash 先清掉）。`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"`。
3. 顶部一条 28px 状态条：`桥 ✓/✗`、`站点 ✓/✗`、`后端 ✓/✗`、`画布 已连接/未连接`、右侧「设置」「刷新」「在浏览器打开」。
   `state` 每 3s 轮询；错误时整条变琥珀色并显示原因。
4. 「设置」展开一个小浮层：改画布地址、复制桥地址（`http://127.0.0.1:<port>`）与 token（点击复制）。

要求：不引入外部依赖；React 用 `require('react')`；所有注释/文案中文；不要 `document.body` 操作；
不要读别的插件的 DOM；卸载时清理定时器（用 `ctx.effect` 或组件 `useEffect` 清理均可，优先组件内）。

---

## 5. 验收

A 自检：`node --check index.js`、`node --check mcp.js`；用 `node -e` 起一个假客户端不现实，改为
`node --check` + 手写的最小 http 冒烟脚本（可选，放在仓库外临时目录，不要提交进包）。

B 自检：`node --check client.js`；确认 `package.json` 的 `exports` 覆盖 `"."`、`"./client"`、`"./locale/*.json"`、`"./icon"`，
`files` 覆盖全部运行时文件，`dsh.client` 为 `{ platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-layout'] }`。

不要运行 `plugin_manager`，不要安装 pnpm，不要改 profile。完成后回报：写了哪些文件、每处关键实现的选择、
以及你认为集成时需要我确认的点。
