---
title: 本地开发
description: 前后端分开启动时的本地开发方式
---

# 本地开发

如果你需要改代码，建议前后端分开启动

## 1. 准备环境变量

```bash
cp .env.example .env
```

默认配置下：

- 后端端口是 `18080`
- 前端端口是 `3000`
- SQLite 数据库是 `data/infinite-canvas.db`
- AI 请求日志默认保存在后端 `data/logs/ai-calls`，可用 `AI_LOG_DIR` 修改；节点信息中的“日志”页签和管理员 `/admin/ai-logs` 从服务器读取这些文件。

## 桌面一键启动（生产模式）

双击仓库根目录的 `restart-local.cmd`，脚本会启动 Go 后端，并在每次重启时先构建前端，再通过 Next.js standalone 服务运行生产版本。构建日志和运行日志保存在 `%TEMP%\infinite-canvas-logs`。代码修改后需要重新运行脚本才能生效。

## 2. 启动后端

在仓库根目录执行：

```bash
go run .
```

后端会读取根目录 `.env`，并监听：

```text
http://127.0.0.1:18080
```

## 3. 启动前端

需要边改代码边预览时，在 `web` 目录运行开发模式：

```bash
bun run dev
```

前端默认访问：

```text
http://localhost:3000
```

开发代理默认转发到 `http://127.0.0.1:18080`。如果你的后端端口不同，启动前设置 `API_BASE_URL`

## 常见场景

- 改画布、页面和交互：主要看 `web/`
- 改接口、业务逻辑和数据库：主要看仓库根目录下的 Go 代码
- 改文档站内容：主要看 `docs/content/docs/`
