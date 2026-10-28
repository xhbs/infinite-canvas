import { nanoid } from "nanoid";
import { useUserStore } from "@/stores/use-user-store";

export type UpyunReferenceStorage = {
    enabled: boolean;
    operator: string;
    password: string;
    bucket: string;
    publicBaseUrl: string;
};
export type UpyunReferenceObject = { url: string; objectKey: string };

type ApiEnvelope<T> = { code: number; data?: T; msg?: string };
const STORAGE_KEY = "infinite-canvas:upyun-reference-storage";

export function defaultUpyunReferenceStorage(): UpyunReferenceStorage {
    return { enabled: false, operator: "", password: "", bucket: "", publicBaseUrl: "" };
}

export function loadUpyunReferenceStorage(): UpyunReferenceStorage {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<UpyunReferenceStorage> | null;
        return {
            enabled: saved?.enabled === true,
            operator: saved?.operator || "",
            password: saved?.password || "",
            bucket: saved?.bucket || "",
            publicBaseUrl: saved?.publicBaseUrl || "",
        };
    } catch {
        return defaultUpyunReferenceStorage();
    }
}

export function saveUpyunReferenceStorage(config: UpyunReferenceStorage) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isUpyunReferenceStorageReady(config: UpyunReferenceStorage) {
    try {
        const url = new URL(config.publicBaseUrl.trim());
        return Boolean(config.enabled && config.operator.trim() && config.password.trim() && config.bucket.trim())
            && url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
    } catch {
        return false;
    }
}

export async function uploadUpyunReferenceImage(blob: Blob, fileName: string, signal?: AbortSignal): Promise<UpyunReferenceObject> {
    const config = loadUpyunReferenceStorage();
    if (!isUpyunReferenceStorageReady(config)) throw new Error("请先在配置中填写并启用又拍云参考图存储");
    const { token, user } = useUserStore.getState();
    if (!token || !user?.id) throw new Error("使用又拍云上传前请先登录画布");
    if (blob.size <= 0 || blob.size > 50 * 1024 * 1024) throw new Error("参考图片必须大于 0 且不超过 50 MB");

    const extension = (fileName.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1] || "png").toLowerCase();
    const date = new Date();
    const objectKey = `canvas-reference/${user.id}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${nanoid()}.${extension}`;
    const form = new FormData();
    form.append("operator", config.operator.trim());
    form.append("password", config.password);
    form.append("bucket", config.bucket.trim());
    form.append("publicBaseUrl", config.publicBaseUrl.trim());
    form.append("objectKey", objectKey);
    form.append("file", blob, fileName || "reference.png");

    let response: Response;
    try {
        response = await fetch("/api/v1/storage/upyun-reference-upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            signal,
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error("连接本机画布或又拍云失败，请确认画布服务运行且网络正常");
    }
    const payload = await response.json().catch(() => null) as ApiEnvelope<UpyunReferenceObject> | null;
    if (!response.ok || payload?.code !== 0 || !payload.data?.url || !payload.data.objectKey) {
        throw new Error(payload?.msg || `又拍云上传失败（HTTP ${response.status}）`);
    }
    return payload.data;
}

export async function deleteUpyunReferenceImage(objectKey: string) {
    const config = loadUpyunReferenceStorage();
    const { token } = useUserStore.getState();
    if (!token || !config.operator.trim() || !config.password.trim() || !config.bucket.trim()) throw new Error("又拍云配置或登录状态不可用，暂时无法清理参考图");
    const response = await fetch("/api/v1/storage/upyun-reference-upload", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ operator: config.operator.trim(), password: config.password, bucket: config.bucket.trim(), objectKey }),
    });
    const payload = await response.json().catch(() => null) as ApiEnvelope<boolean> | null;
    if (!response.ok || payload?.code !== 0) throw new Error(payload?.msg || `又拍云参考图清理失败（HTTP ${response.status}）`);
}
