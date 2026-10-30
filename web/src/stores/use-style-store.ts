import { create } from "zustand";

import { deleteStyle, fetchStyles, saveStyle, type GenerationStyle } from "@/services/api/styles";
import { useUserStore } from "@/stores/use-user-store";

type StyleStore = {
    styles: GenerationStyle[];
    isLoading: boolean;
    loadedFor: string;
    load: () => Promise<void>;
    save: (style: Partial<GenerationStyle>) => Promise<GenerationStyle>;
    remove: (id: string) => Promise<void>;
};

let inFlightToken = "";
let inFlightLoad: Promise<void> | null = null;

export const useStyleStore = create<StyleStore>((set, get) => ({
    styles: [],
    isLoading: false,
    loadedFor: "",
    load: async () => {
        const token = useUserStore.getState().token;
        if (!token) {
            set({ styles: [], loadedFor: "", isLoading: false });
            return;
        }
        if (get().loadedFor === token) return;
        if (inFlightToken === token && inFlightLoad) return inFlightLoad;
        inFlightToken = token;
        set({ styles: [], loadedFor: "", isLoading: true });
        inFlightLoad = fetchStyles(token).then((styles) => {
            if (useUserStore.getState().token === token) set({ styles, loadedFor: token });
        }).finally(() => {
            if (inFlightToken === token) {
                inFlightToken = "";
                inFlightLoad = null;
                set({ isLoading: false });
            }
        });
        return inFlightLoad;
    },
    save: async (style) => {
        const token = useUserStore.getState().token;
        if (!token) throw new Error("请先登录后使用风格库");
        const saved = await saveStyle(token, style);
        if (useUserStore.getState().token === token) {
            if (get().loadedFor === token) set((state) => ({ styles: [saved, ...state.styles.filter((item) => item.id !== saved.id)] }));
            else {
                const styles = await fetchStyles(token);
                if (useUserStore.getState().token === token) set({ styles, loadedFor: token });
            }
        }
        return saved;
    },
    remove: async (id) => {
        const token = useUserStore.getState().token;
        if (!token) throw new Error("请先登录后使用风格库");
        await deleteStyle(token, id);
        if (useUserStore.getState().token === token) {
            if (get().loadedFor === token) set((state) => ({ styles: state.styles.filter((item) => item.id !== id) }));
            else {
                const styles = await fetchStyles(token);
                if (useUserStore.getState().token === token) set({ styles, loadedFor: token });
            }
        }
    },
}));
