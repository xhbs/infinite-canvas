import { useUserStore } from "@/stores/use-user-store";

export type CanvasRequestLog = {
    id: string;
    nodeId: string;
    createdAt: number;
    method: string;
    endpoint: string;
    model: string;
    channelId: string;
    channelName: string;
    status: number;
    durationMs: number;
    requestBody: string;
    responseBody: string;
    error: string;
};

export async function saveCanvasRequestLog(log: CanvasRequestLog) {
    try {
        const token = useUserStore.getState().token;
        if (!token) return;
        await fetch("/api/v1/canvas/request-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(log),
        });
    } catch {
        // Request logging must never break generation.
    }
}

export async function getCanvasRequestLogs(nodeId: string) {
    try {
        const token = useUserStore.getState().token;
        if (!token) return [];
        const response = await fetch(`/api/v1/canvas/request-logs?nodeId=${encodeURIComponent(nodeId)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json() as { code?: number; data?: { items?: CanvasRequestLog[] } };
        return response.ok && payload.code === 0 ? payload.data?.items || [] : [];
    } catch {
        return [];
    }
}

export function stringifyCanvasRequestBody(value: unknown) {
    if (value instanceof FormData) {
        const fields: Record<string, string[]> = {};
        const files: Array<{ field: string; name: string; size: number; type: string }> = [];
        value.forEach((item, key) => {
            if (item instanceof Blob) {
                files.push({ field: key, name: item instanceof File ? item.name : "blob", size: item.size, type: item.type });
            } else {
                fields[key] = [...(fields[key] || []), item];
            }
        });
        return JSON.stringify({ fields, files }, null, 2);
    }
    return JSON.stringify(value, null, 2) || String(value);
}
