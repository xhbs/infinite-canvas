export type VoiceDesignSnapshot = {
    alias: string;
    voiceDesign: string;
};

export function appendVoicePreset(prompt: string, name?: string, roles?: VoiceDesignSnapshot[]) {
    if (!name || !roles?.length) return prompt;
    const descriptions = roles.map(({ alias, voiceDesign }) => `- ${alias}：${voiceDesign}`).join("\n");
    return `${prompt.trim()}${prompt.trim() ? "\n\n" : ""}语音预设（${name}）：\n${descriptions}`;
}
