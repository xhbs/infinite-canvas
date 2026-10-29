#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const configPath = process.env.CANVAS_AGENT_CONFIG || resolve(homedir(), ".infinite-canvas", "codex-agent.json");
const imageTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };
const maxImageBytes = 10 * 1024 * 1024;
const tool = {
    name: "upload_local_image",
    description: "将 Agent 所在电脑上的图片文件导入当前画布，仅保存到浏览器本地，不上传云端。",
    inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Agent 所在电脑可读取的图片文件路径" } },
        required: ["path"],
        additionalProperties: false,
    },
};

const server = new Server({ name: "canvas-local-image", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
    try {
        if (params.name !== tool.name) throw new Error("不支持的工具");
        const imagePath = params.arguments?.path;
        if (typeof imagePath !== "string" || !imagePath.trim()) throw new Error("请提供图片文件路径");
        const absolutePath = resolve(imagePath);
        const mimeType = imageTypes[extname(absolutePath).toLowerCase()];
        if (!mimeType) throw new Error("仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片");
        const stat = statSync(absolutePath);
        if (!stat.isFile() || !stat.size || stat.size > maxImageBytes) throw new Error("图片为空或超过 10 MB");

        const config = loadConfig();
        const response = await fetch(`${config.url}/tools/call`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-canvas-agent-token": config.token },
            body: JSON.stringify({
                clientId: process.env.CANVAS_AGENT_CLIENT_ID || "",
                source: "external",
                name: "import_image_data",
                arguments: { fileName: basename(absolutePath), mimeType, dataBase64: readFileSync(absolutePath).toString("base64") },
            }),
            signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `画布连接失败：${response.status}`);
        return { isError: result?.ok === false, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "本地图片导入失败" }] };
    }
});

function loadConfig() {
    const saved = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;
    const token = process.env.CANVAS_AGENT_TOKEN || saved?.token;
    const url = (process.env.CANVAS_AGENT_URL || saved?.url || `http://127.0.0.1:${process.env.CANVAS_AGENT_PORT || saved?.port || 3210}`).replace(/\/$/, "");
    if (!token) throw new Error(`未找到 Canvas Agent Token：${configPath}`);
    return { url, token };
}

await server.connect(new StdioServerTransport());
