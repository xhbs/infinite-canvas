import { create } from "zustand";

import { deleteVoicePreset, fetchVoicePresets, saveVoicePreset, type VoicePreset, type VoicePresetInput } from "@/services/api/voice-presets";
import { useUserStore } from "@/stores/use-user-store";

type VoicePresetStore = {
    presets: VoicePreset[];
    loadedFor: string;
    isLoading: boolean;
    load: () => Promise<void>;
    save: (preset: VoicePresetInput) => Promise<VoicePreset>;
    remove: (id: string) => Promise<void>;
};

let loadingToken = "";
let loadingPromise: Promise<void> | null = null;

export const useVoicePresetStore = create<VoicePresetStore>((set, get) => ({
    presets: [],
    loadedFor: "",
    isLoading: false,
    load: async () => {
        const token = useUserStore.getState().token;
        if (!token) {
            set({ presets: [], loadedFor: "", isLoading: false });
            return;
        }
        if (get().loadedFor === token) return;
        if (loadingToken === token && loadingPromise) return loadingPromise;
        loadingToken = token;
        set({ presets: [], loadedFor: "", isLoading: true });
        loadingPromise = fetchVoicePresets(token).then((presets) => {
            if (useUserStore.getState().token === token) set({ presets, loadedFor: token });
        }).finally(() => {
            if (loadingToken === token) {
                loadingToken = "";
                loadingPromise = null;
                set({ isLoading: false });
            }
        });
        return loadingPromise;
    },
    save: async (preset) => {
        const token = useUserStore.getState().token;
        if (!token) throw new Error("请先登录后管理语音预设");
        const saved = await saveVoicePreset(token, preset);
        if (useUserStore.getState().token === token) {
            const existing = get().loadedFor === token ? get().presets : await fetchVoicePresets(token);
            if (useUserStore.getState().token === token) set({ presets: [saved, ...existing.filter((item) => item.id !== saved.id)], loadedFor: token });
        }
        return saved;
    },
    remove: async (id) => {
        const token = useUserStore.getState().token;
        if (!token) throw new Error("请先登录后管理语音预设");
        await deleteVoicePreset(token, id);
        if (useUserStore.getState().token === token) {
            const existing = get().loadedFor === token ? get().presets : await fetchVoicePresets(token);
            if (useUserStore.getState().token === token) set({ presets: existing.filter((item) => item.id !== id), loadedFor: token });
        }
    },
}));
