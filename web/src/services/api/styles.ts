import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export type GenerationStyle = {
    id: string;
    userId: string;
    name: string;
    prompt: string;
    appliesTo: "image" | "video" | "both";
    createdAt: string;
    updatedAt: string;
};

export function fetchStyles(token: string) {
    return apiGet<GenerationStyle[]>("/api/v1/styles", undefined, token);
}

export function saveStyle(token: string, style: Partial<GenerationStyle>) {
    return apiPost<GenerationStyle>("/api/v1/styles", style, token);
}

export function deleteStyle(token: string, id: string) {
    return apiDelete<boolean>(`/api/v1/styles/${encodeURIComponent(id)}`, token);
}
