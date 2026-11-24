# canvas-bridge 使用说明

本机画布桥作为项目服务独立运行，画布打开后自动连接。Codex、Claude Desktop 与 DSH MCP 客户端都可通过 MCP 操作同一张画布。

```
Codex / DSH MCP / Claude ── MCP(stdio) ──► canvas-bridge（项目内独立服务） ──SSE──► 画布页
                                                                                     └─ executeTool（画布工具）
```

- 桌面一键启动脚本会启动项目桥，无需先启动 DeepSeek Harness。
- 桥地址：`http://127.0.0.1:3211`（占用时 3212…3220，实际端口见 `/config`）
- 凭据：项目 `data/storages/canvas-bridge/settings.json` 中的 `token`（32 字节 hex）
- MCP 入口：`canvas-bridge/mcp.js`，由 MCP 客户端直接启动
- 画布页是唯一执行端：桥不存画布状态；页面关掉时工具会返回可纠正的错误，而不是消失

## 1. 在 DSH 里打开画布（主路径）

1. 确保画布站点与后端在跑：`http://localhost:3000`（Next.js）和 Go 后端（默认 `127.0.0.1:18080`）。
   面板顶部状态条会分别显示 **桥 / 站点 / 后端 / 画布** 四盏灯。
2. 点左侧栏最下面的「**画布**」，首次会让你粘贴画布地址：
   `http://localhost:3000/canvas/<你的画布id>`（从浏览器地址栏复制即可，hash 会被自动剥掉）。
3. 保存后 iframe 自动带上 `#agentUrl=…&agentToken=…` 加载，页面自己连桥，状态条「画布」变已连接。
4. 第一次在 iframe 里需要登录一次（画布的登录态是 localStorage 里的 token，iframe 的存储分区和普通浏览器标签不同；
   登录一次后就记住了）。第三方登录弹窗已放行。

> 之后直接在这个面板里用画布即可，不必再开浏览器。想用系统浏览器时点状态条右侧「在浏览器打开」。

## 2. Codex（CLI / IDE）

```powershell
codex mcp add infinite-canvas -- node "D:\software\infinite-canvas\canvas-bridge\mcp.js"
```

或在 `~/.codex/config.toml`：

```toml
[mcp_servers.infinite-canvas]
command = "C:\\nvm4w\\nodejs\\node.exe"
args = ["D:\\software\\infinite-canvas\\canvas-bridge\\mcp.js"]
```

## 3. Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "infinite-canvas": {
      "command": "C:\\nvm4w\\nodejs\\node.exe",
      "args": ["D:\\software\\infinite-canvas\\canvas-bridge\\mcp.js"]
    }
  }
}
```

改完重启 Claude Desktop。工具名保持画布原名（`get_canvas_summary`、`generate_image`…），DSH 里的原生工具带
`canvas_` 前缀（`canvas_get_canvas_summary`），两套名字指向同一批工具、同一张画布。

## 4. 多端同时用

- 桥对**每个画布会话串行**执行调用，DSH 和 Codex 不会交叉写节点；排队超过 30s 会返回「画布正忙」。
- 同一画布被新窗口连上时，旧会话标记 `superseded`，旧客户端的调用返回 `canvas_reconnected`。
- 多张画布：工具参数里带 `canvasId`；只有一个连接时自动选中。

## 5. 排错

| 现象 | 处理 |
|---|---|
| 桥未连接 | 确认桌面启动脚本已启动桥；检查 `http://127.0.0.1:3211/config`，端口占用时检查 3212–3220 |
| 面板「站点 ✗」 | `http://localhost:3000/canvas` 打不开：先起 Next dev |
| 面板「后端 ✗」 | `http://localhost:3000/api/health` 不通：起 Go 后端（默认 18080） |
| 工具报「画布未连接」 | 侧栏「画布」面板没打开或页面崩了；打开/刷新即可 |
| 工具报「canvas_reconnected」 | 同一画布在别处重新连接了，用最新那个窗口 |
| 改了 token（删了 settings.json） | 面板点「刷新」重挂 iframe；MCP 客户端重启 |

诊断命令：

```powershell
Invoke-RestMethod http://127.0.0.1:3211/config
Invoke-RestMethod http://127.0.0.1:3211/health
```
