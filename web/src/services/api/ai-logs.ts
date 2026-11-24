import { localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ensureAnonymousStorageSession } from "@/services/anonymous-storage";
import type { AdminAICallLog } from "./admin";

export type AICallLog = AdminAICallLog & { nodeId?: string; taskId?: string; stage?: string };
type AICallLogList = { items: AICallLog[]; total: number };
type LogStage = "create" | "poll" | "upload";
type ApiPayload<T> = { code: number; data: T; msg?: string };

const BODY_LIMIT = 256 * 1024;
let warned = false;
const streamLogs = new WeakMap<Response, (payload: unknown, error?: unknown) => void>();

export function finishAIStreamLog(response: Response, payload: unknown, error?: unknown) {
    streamLogs.get(response)?.(payload, error);
    streamLogs.delete(response);
}

function warnLogFailure() {
    if (warned) return;
    warned = true;
    console.warn("AI 请求日志未能保存到服务器，请检查日志接口或匿名会话；生成请求不受影响。");
}

async function requestLogs<T>(token: string, query: string, init: RequestInit): Promise<T> {
    if (!token) await ensureAnonymousStorageSession();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${token ? "/api/v1/ai-logs" : "/api/anonymous/files/ai-logs"}${query}`, {
        ...init, headers, credentials: "same-origin",
    });
    const payload = await response.json() as ApiPayload<T>;
    if (!response.ok || payload.code !== 0) throw new Error(payload.msg || `日志请求失败（${response.status}）`);
    return payload.data;
}

export function fetchNodeAICallLogs(nodeId: string, page: number, pageSize = 20, signal?: AbortSignal) {
    const token = useUserStore.getState().token;
    const query = new URLSearchParams({ nodeId, page: String(page), pageSize: String(pageSize) });
    return requestLogs<AICallLogList>(token, `?${query}`, { signal });
}

function secretField(key: string) {
    return /authorization|password|passwd|secret|credential|cookie|signature|(?:api|access|private|signing|upload|auth)key|^(?:key|auth|sig|bearer)$|token$/i.test(key.replace(/[^a-z0-9]/gi, ""));
}

function responseFailure(value: unknown, depth = 0): string {
    if (depth > 8) return "";
    if (typeof value === "string") {
        try { return responseFailure(JSON.parse(value), depth + 1); } catch { return ""; }
    }
    if (Array.isArray(value)) return value.map((item) => responseFailure(item, depth + 1)).find(Boolean) || "";
    if (!value || typeof value !== "object") return "";
    const body = value as Record<string, unknown>;
    const error = body.error;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object" && Object.keys(error).length) {
        const detail = error as Record<string, unknown>;
        return String(detail.message || detail.detail || detail.code || "上游返回错误");
    }
    if (/^(?:failed|failure|error|incomplete|cancelled|canceled)$/i.test(String(body.status || "")) || body.success === false) return String(body.message || body.msg || body.status || "上游业务请求失败");
    return [body.data, body.response, body.result, body.events].map((item) => responseFailure(item, depth + 1)).find(Boolean) || "";
}

function createSanitizer(config: AiConfig, headers?: HeadersInit) {
    const channel = localChannelForActiveModel(config);
    const secrets = new Set([config.apiKey, channel?.apiKey, channel?.uploadApiKey, useUserStore.getState().token].filter((value): value is string => Boolean(value)));
    new Headers(headers).forEach((value, key) => {
        if (secretField(key)) {
            secrets.add(value);
            secrets.add(value.replace(/^(?:Bearer|Basic)\s+/i, ""));
        }
    });
    const hideSecrets = (text: string) => {
        for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]");
        return text;
    };
    const cleanURL = (text: string) => {
        try {
            const url = new URL(text, window.location.origin);
            url.username = "";
            url.password = "";
            url.hash = "";
            for (const key of new Set(url.searchParams.keys())) if (secretField(key)) url.searchParams.set(key, "[redacted]");
            return hideSecrets(url.href);
        } catch { return hideSecrets(text); }
    };
    const cleanText = (text: string) => hideSecrets(text)
        .replace(/https?:\/\/[^\s"'<>]+/gi, cleanURL)
        .replace(/data:[^\s,]+,[a-z0-9+/_=-]+/gi, (value) => `[media data, ${value.length} chars]`)
        .replace(/[a-z0-9+/]{2048,}={0,2}/gi, (value) => `[base64, ${value.length} chars]`)
        .replace(/(["']?)([\w-]+)\1\s*[:=]\s*("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;&}\]]+)/g, (match, _quote: string, key: string) => secretField(key) ? `${key}: [redacted]` : match)
        .replace(/\b(Bearer|Basic)\s+[a-z0-9+/_=.-]+/gi, "$1 [redacted]");
    const clean = (value: unknown, key = "", depth = 0): unknown => {
        if (secretField(key)) return "[redacted]";
        if (depth > 16) return "[nested value omitted]";
        if (value instanceof Blob) return { type: value.type, bytes: value.size, ...(value instanceof File ? { name: cleanText(value.name) } : {}) };
        if (value instanceof FormData || value instanceof URLSearchParams) {
            const entries: unknown[] = [];
            for (const [name, item] of value) entries.push([name, clean(item, name, depth + 1)]);
            return entries;
        }
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { bytes: value.byteLength, type: "binary" };
        if (value instanceof ReadableStream) return "[request stream]";
        if (typeof value === "string") {
            if (/^(?:b64_json|base64|bytesBase64Encoded|partial_image_b64)$/i.test(key) || /^data:/i.test(value)) return `[media data, ${value.length} chars]`;
            try { return clean(JSON.parse(value), key, depth + 1); } catch { return value.length > BODY_LIMIT ? `[large value, ${value.length} chars]` : cleanText(value); }
        }
        if (Array.isArray(value)) return value.map((item) => clean(item, "", depth + 1));
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item, name, depth + 1)]));
        return value;
    };
    return {
        url: cleanURL,
        text: cleanText,
        body(value: unknown) {
            if (value == null) return "";
            const result = clean(value);
            const text = typeof result === "string" ? result : JSON.stringify(result, null, 2) || "";
            return new Blob([text]).size <= BODY_LIMIT && new Blob([JSON.stringify(text)]).size <= BODY_LIMIT * 3 ? text : `[large body, ${text.length} chars]`;
        },
    };
}

async function responseBody(response: Response) {
    const type = response.headers.get("Content-Type") || "";
    const bytes = Number(response.headers.get("Content-Length")) || undefined;
    if ((type && !/json|text|xml|javascript|x-www-form-urlencoded/i.test(type)) || (bytes && bytes > BODY_LIMIT)) return { type, bytes, summary: "响应体为二进制或超过 256 KiB，省略内容" };
    const reader = response.clone().body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let text = "", size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 10000);
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > BODY_LIMIT) return { type, bytes, summary: "响应体超过 256 KiB，保留已读取文本摘要", preview: text.slice(0, 16384) };
            text += decoder.decode(value, { stream: true });
        }
        if (timedOut) return { type, bytes, summary: "响应流尚未结束，保留已读取文本摘要", preview: text.slice(0, 16384) };
        return text + decoder.decode();
    } finally {
        clearTimeout(timer);
        // Do not await cancellation of a clone: the caller still owns the original stream.
        void reader.cancel().catch(() => undefined);
    }
}

export async function loggedAIFetch(config: AiConfig, url: string | URL, init: RequestInit = {}, stage: LogStage = "create"): Promise<Response> {
    const target = new URL(String(url), window.location.origin);
    if (target.origin === window.location.origin && target.pathname.startsWith("/api/v1/")) return fetch(url, init);
    const token = useUserStore.getState().token;
    if (!token) void ensureAnonymousStorageSession().catch(warnLogFailure);
    const startedAt = Date.now();
    const channel = localChannelForActiveModel(config);
    const context = { ...config.aiLogContext };
    const report = async (response?: Response, error?: unknown, payload?: unknown) => {
        try {
            const sanitizer = createSanitizer(config, init.headers);
            let body: unknown = "";
            try { body = payload !== undefined ? payload : response ? await responseBody(response) : ""; }
            catch (readError) { error ||= readError; body = "[响应体读取失败]"; }
            const endedAt = new Date().toISOString();
            const failure = error instanceof Error ? `${error.name}: ${error.message}` : error != null ? String(error) : responseFailure(body) || (response && !response.ok ? `HTTP ${response.status} ${response.statusText}`.trim() : "");
            await requestLogs(token, "", {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
                body: JSON.stringify({
                    ...context, stage: payload !== undefined ? "response" : stage, endpoint: sanitizer.url(String(url)), method: init.method || "GET",
                    model: config.model, channelId: channel?.id || config.activeChannelId || "", channelName: channel?.name || "本地直连",
                    status: response?.status || 0, durationMs: Date.now() - startedAt, startedAt: new Date(startedAt).toISOString(),
                    completedAt: failure ? "" : endedAt, failedAt: failure ? endedAt : "",
                    requestBody: sanitizer.body(init.body), responseBody: sanitizer.body(body), error: sanitizer.body(failure).slice(0, 4096),
                }),
            });
        } catch { warnLogFailure(); }
    };
    try {
        const response = await fetch(url, init);
        if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
            streamLogs.set(response, (payload, error) => { setTimeout(() => void report(response, error, payload), 0); });
        }
        void report(response);
        return response;
    } catch (error) {
        void report(undefined, error);
        throw error;
    }
}
