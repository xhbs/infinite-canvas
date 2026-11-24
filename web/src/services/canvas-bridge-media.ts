"use client";

// canvas-bridge 媒体中继，可选：把画布图片/视频字节同步到本机 canvas-bridge，
// 让同一张画布在另一个浏览器分区也能看到同一份媒体。
// 没有 canvas-codex-connection 时所有函数立即静默返回，画布原有行为完全不变。

const CONNECTION_KEY = "canvas-codex-connection";
const PUT_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 20_000;
const LIST_TIMEOUT_MS = 5_000;

export type BridgeConnection = { endpoint: string; token: string };

export type BridgePushResult = { pushed: number; skipped: number; failed: number };

export function bridgeConnection(): BridgeConnection | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(CONNECTION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { endpoint?: unknown; token?: unknown };
            const connection = normalizeConnection(parsed?.endpoint, parsed?.token);
            if (connection) return connection;
        }
        // 首屏竞态兜底：画布页刚从 #agentUrl&agentToken 打开时，localStorage 可能还没写入，
        // 而 use-codex-agent 会立刻把 hash 抹掉。这里在模块初始化时缓存一份 hash 凭据。
        return initialHashConnection;
    } catch {
        return null;
    }
}

function normalizeConnection(endpoint: unknown, token: unknown): BridgeConnection | null {
    const value = typeof endpoint === "string" ? endpoint.trim() : "";
    const secret = typeof token === "string" ? token.trim() : "";
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) return null;
    if (secret.length < 16) return null;
    return { endpoint: url.origin, token: secret };
}

const initialHashConnection: BridgeConnection | null = (() => {
    if (typeof window === "undefined") return null;
    try {
        const hash = window.location.hash.slice(1);
        if (!hash) return null;
        const params = new URLSearchParams(hash);
        return normalizeConnection(params.get("agentUrl"), params.get("agentToken"));
    } catch {
        return null;
    }
})();

/** 等桥连接就绪：仅当页面本来就是带着连接参数打开时才等待，避免普通浏览器里空转。 */
async function waitForBridgeConnection(timeoutMs = 2500): Promise<BridgeConnection | null> {
    const immediate = bridgeConnection();
    if (immediate) return immediate;
    if (!initialHashConnection) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const next = bridgeConnection();
        if (next) return next;
    }
    return bridgeConnection();
}

export async function putBridgeMedia(storageKey: string, blob: Blob): Promise<boolean> {
    const connection = bridgeConnection();
    if (!connection || !storageKey || !blob || blob.size === 0) return false;
    try {
        const response = await fetch(`${connection.endpoint}/media/${encodeURIComponent(storageKey)}`, {
            method: "PUT",
            headers: { "content-type": blob.type || "application/octet-stream", "x-canvas-agent-token": connection.token },
            body: blob,
            signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
        });
        if (!response.ok) {
            console.debug("[canvas-bridge] 媒体上传失败", storageKey, response.status);
            return false;
        }
        return true;
    } catch (error) {
        console.debug("[canvas-bridge] 媒体上传失败", storageKey, error);
        return false;
    }
}

export async function getBridgeMedia(storageKey: string): Promise<Blob | null> {
    const connection = bridgeConnection();
    if (!connection || !storageKey) return null;
    try {
        const response = await fetch(`${connection.endpoint}/media/${encodeURIComponent(storageKey)}`, {
            headers: { "x-canvas-agent-token": connection.token },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const blob = await response.blob();
        return blob.size ? blob : null;
    } catch (error) {
        console.debug("[canvas-bridge] 媒体读取失败", storageKey, error);
        return null;
    }
}

export async function listBridgeMedia(): Promise<Set<string>> {
    const connection = bridgeConnection();
    if (!connection) return new Set();
    try {
        const response = await fetch(`${connection.endpoint}/media`, {
            headers: { "x-canvas-agent-token": connection.token },
            signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
        });
        if (!response.ok) return new Set();
        const payload = (await response.json().catch(() => null)) as { keys?: Array<{ key?: unknown }> } | null;
        return new Set((payload?.keys || []).map((item) => (typeof item?.key === "string" ? item.key : "")).filter(Boolean));
    } catch (error) {
        console.debug("[canvas-bridge] 媒体列表读取失败", error);
        return new Set();
    }
}

export async function pushProjectMediaToBridge(nodes: unknown): Promise<BridgePushResult> {
    const result: BridgePushResult = { pushed: 0, skipped: 0, failed: 0 };
    // 未连接本机桥时不产生任何网络请求；带连接参数打开的页面给桥 2.5s 让连接就绪
    if (!(await waitForBridgeConnection())) return result;
    // 一次性全量迁移入口：打开 /canvas/<id>?bridge-export-all=1 时，把本浏览器两个媒体库
    // （image_files / media_files）里所有字节推给桥，不限于当前项目引用的 key。
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("bridge-export-all") === "1") {
        return exportAllLocalMedia();
    }
    try {
        const keys = collectProjectStorageKeys(nodes);
        if (!keys.size) return result;
        const existing = await listBridgeMedia();
        const pending = Array.from(keys).filter((key) => !existing.has(key));
        result.skipped = keys.size - pending.length;
        if (!pending.length) return result;
        const [{ getImageBlob }, { getMediaBlob }] = await Promise.all([
            import("@/services/image-storage"),
            import("@/services/file-storage"),
        ]);
        for (const key of pending) {
            const blob = await (key.startsWith("image:") ? getImageBlob(key) : getMediaBlob(key)).catch(() => null);
            if (!blob) {
                // 本地没有字节（例如服务端对象或已清理），不算失败
                result.skipped += 1;
                continue;
            }
            if (await putBridgeMedia(key, blob)) result.pushed += 1;
            else result.failed += 1;
        }
        return result;
    } catch (error) {
        console.debug("[canvas-bridge] 项目媒体同步失败", error);
        return result;
    }
}

function collectProjectStorageKeys(nodes: unknown) {
    const keys = new Set<string>();
    if (!Array.isArray(nodes)) return keys;
    for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const metadata = (node as { metadata?: unknown }).metadata;
        if (!metadata || typeof metadata !== "object") continue;
        const key = (metadata as { storageKey?: unknown }).storageKey;
        if (typeof key === "string" && key && !key.startsWith("server:")) keys.add(key);
    }
    return keys;
}

/**
 * 一次性全量迁移：把本浏览器里 image_files / media_files 两个库的所有字节推给桥。
 * 只读本地库、只发 PUT，不改任何画布数据，因此可以重复执行（桥已存在的会跳过）。
 */
export async function exportAllLocalMedia(): Promise<BridgePushResult> {
    const result: BridgePushResult = { pushed: 0, skipped: 0, failed: 0 };
    if (!(await waitForBridgeConnection())) return result;
    try {
        const [{ default: localforage }, existing] = await Promise.all([
            import("localforage"),
            listBridgeMedia(),
        ]);
        const uploaded = new Set<string>();
        for (const storeName of ["image_files", "media_files"] as const) {
            const store = localforage.createInstance({ name: "infinite-canvas", storeName });
            const keys: string[] = [];
            await store.iterate((_value: unknown, key: string) => {
                keys.push(String(key));
            });
            console.info(`[canvas-bridge] ${storeName}: 本地 ${keys.length} 个条目，桥已有 ${existing.size} 个`);
            for (const key of keys) {
                // image_files 与 media_files 可能存有同一个 storageKey，只传一次
                if (uploaded.has(key) || existing.has(key)) {
                    result.skipped += 1;
                    continue;
                }
                const blob = await store.getItem<Blob>(key).catch(() => null);
                if (!blob || !(blob instanceof Blob) || blob.size === 0) {
                    result.skipped += 1;
                    continue;
                }
                if (await putBridgeMedia(key, blob)) {
                    uploaded.add(key);
                    result.pushed += 1;
                    console.info(`[canvas-bridge] 已上传 ${result.pushed}：${key}（${Math.round(blob.size / 1024)} KB）`);
                } else {
                    result.failed += 1;
                    console.info(`[canvas-bridge] 上传失败：${key}`);
                }
            }
        }
        console.info("[canvas-bridge] 全量迁移完成", result);
        return result;
    } catch (error) {
        console.debug("[canvas-bridge] 全量迁移失败", error);
        return result;
    }
}
