export function appendGenerationStyle(prompt: string, stylePrompt?: string) {
    const style = stylePrompt?.trim();
    return style ? `${prompt.trim()}${prompt.trim() ? "\n\n" : ""}风格:${style}` : prompt;
}
