import { apiDelete, apiGet, apiPost } from "@/services/api/request";

export type VoicePresetRole = {
    id: string;
    presetId: string;
    userId: string;
    alias: string;
    voiceDesign: string;
    createdAt: string;
    updatedAt: string;
};

export type VoicePresetRoleInput = Pick<VoicePresetRole, "alias" | "voiceDesign"> & { id?: string };

export type VoicePreset = {
    id: string;
    userId: string;
    name: string;
    description?: string;
    roles: VoicePresetRole[];
    createdAt: string;
    updatedAt: string;
};

export type VoicePresetInput = Partial<Omit<VoicePreset, "roles">> & { roles?: VoicePresetRoleInput[] };

export function fetchVoicePresets(token: string) {
    return apiGet<VoicePreset[]>("/api/v1/voice-presets", undefined, token);
}

export function saveVoicePreset(token: string, preset: VoicePresetInput) {
    return apiPost<VoicePreset>("/api/v1/voice-presets", preset, token);
}

export function deleteVoicePreset(token: string, id: string) {
    return apiDelete<boolean>(`/api/v1/voice-presets/${encodeURIComponent(id)}`, token);
}
