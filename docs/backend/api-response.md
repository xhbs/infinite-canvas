---
title: 接口响应约定
description: 业务接口统一响应结构与前端处理约定
---

# 接口响应约定

后端业务接口统一返回 JSON：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

- `code`: 业务状态码，`0` 表示成功，非 `0` 表示失败。
- `data`: 业务数据。失败时通常为 `null`。
- `msg`: 响应消息。成功默认为 `ok`，失败时放错误原因。

前端请求逻辑以 `code` 判断业务是否成功。当前后端业务失败也会返回 HTTP 200，前端不要只依赖 HTTP 状态码判断结果。

接口连接失败、服务不可达、返回体不是约定 JSON 时，前端按网络或接口异常处理。

## 节点请求日志

- 登录账号使用 `POST /api/v1/ai-logs` 上报浏览器直连请求，`GET /api/v1/ai-logs?nodeId=...&page=1&pageSize=20` 查询当前用户对应节点的日志。后端代理请求和后台轮询直接在服务器记录。
- 未登录直连复用匿名存储会话：先 `POST /api/anonymous/files/session` 建立 HttpOnly 会话，再通过 `/api/anonymous/files/ai-logs` 的 POST / GET 上报和查询，参数与登录接口一致。归属来自服务器验证的账号或匿名会话，不接受客户端伪造用户 ID。
- 查询返回 `{ code: 0, data: { items: [...], total: 0 }, msg: "ok" }`。每条记录包含 `nodeId`、`taskId`、`stage`、`endpoint`、`method`、`model`、`channelName`、`status`、`failed`、`startedAt`、`completedAt`、`failedAt`、`durationMs`、`requestBody`、`responseBody`、`error` 等字段，按记录时间倒序排列。
- 上报请求体上限为 2 MiB；解析或服务器写入失败返回非零业务 `code`。日志上报失败不改变生成结果。图片、视频生成和轮询日志不受“其他直连日志上报”开关控制。

## AutoDL 渠道

- `POST /api/ai/autodl/workflows` 使用上述业务响应结构。请求为 `{ baseUrl, workflowId? }`，不传上游 API Key；不带工作流 ID 返回列表，带 ID 返回详情。元数据包含 `uuid`、`name`、`kind` 和详情的 `input_rules`，不返回上游内部节点映射。
- AutoDL 视频继续使用现有 `/api/v1/videos` 创建、查询及任务响应结构。
- `/api/v1/audio/speech` 是 AI 协议代理入口。AutoDL 成功时返回 `{ provider: "autodl", audio_url, mime_type }`；MiniMax 和 TokenDance MiniMax 成功时解码上游 hex，并返回所选格式的音频二进制；失败仍使用现有 `Fail` 业务结构。其他语音协议的响应保持原样。
- 现有 `/api/v1/canvas/audio-tasks` 消费 AutoDL 的上游音频 URL，返回既有任务结构，不新增结果下载或转存。

## 渠道自定传参转译

- 沿用 `/api/v1/images/generations`、`/api/v1/images/edits`、`/api/v1/audio/speech`、`/api/v1/videos` 及现有画布任务入口。命中自定义的账号请求携带 `{ model, n, _parameterTranslation: { kind, variables } }`；视频另携带面板 `seconds`，沿用现有按秒费用计算。`kind` 为 `image`、`video`、`audio`。
- `_parameterTranslation` 是系统内部负载。后端按账号或公共渠道读取保存的原文，转译后只向供应商发送配置里的方法、地址、请求头、查询参数和请求体。
- 图片 JSON 结果归一为 `{ data: [{ url }] }`；音频 URL 归一为 `{ provider: "parameter-translation", audio_url }`。配置直接返回文件时沿用二进制响应及 MIME。失败仍用现有 `Fail` 业务结构。
- 视频沿用现有任务响应，增加 `parameter_translation: true` 标记；私有查询快照和公共渠道脚本不随响应返回。创建、查询、完成和失败均进入现有任务管理，失败不重发默认请求。
