import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasAssistantSession } from "../types";

export type StoredAgentSessions = {
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
};

function storageKey(projectId: string) {
    return `infinite-canvas:agent-sessions:${projectId}`;
}

export async function loadAgentSessions(projectId: string): Promise<StoredAgentSessions | null> {
    const value = await localForageStorage.getItem(storageKey(projectId));
    if (!value) return null;
    try {
        return JSON.parse(value) as StoredAgentSessions;
    } catch {
        return null;
    }
}

export function saveAgentSessions(projectId: string, value: StoredAgentSessions) {
    return localForageStorage.setItem(storageKey(projectId), JSON.stringify(value));
}

export function deleteAgentSessions(projectId: string) {
    return localForageStorage.removeItem(storageKey(projectId));
}
