# Canvas Local Image MCP

独立的本地 MCP 工具，读取 Agent 所在电脑上的图片文件，并通过本机 Canvas Agent 服务导入当前画布。图片通过画布的 `localOnly` 存储路径保存到浏览器，不上传云端。

## 准备

- Node.js 22 或更新版本
- 已连接画布的 Canvas Agent 本地服务
- 画布代码包含 `import_image_data` 接收工具

在此目录运行一次 `npm install`。MCP 默认读取 `~/.infinite-canvas/codex-agent.json` 中的本地服务 URL 和 Token；多画布连接时可设置 `CANVAS_AGENT_CLIENT_ID`，其他环境可用 `CANVAS_AGENT_CONFIG`、`CANVAS_AGENT_URL` 和 `CANVAS_AGENT_TOKEN` 覆盖配置。

## 注册

将下面的 MCP server 项目添加到本机 Agent 配置，并将路径替换为本目录的绝对路径：

```json
{
  "mcpServers": {
    "canvas-local-image": {
      "command": "node",
      "args": ["D:/software/infinite-canvas/canvas-local-image-mcp/index.mjs"]
    }
  }
}
```

重启 Agent 后调用 `upload_local_image`，传入 Agent 可读取的图片路径。仅支持 PNG、JPEG、WebP、GIF 和 AVIF，最大 10 MB。
