export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f7f5f0",
            dot: "rgba(112,105,92,.18)",
            line: "rgba(112,105,92,.08)",
            selectionStroke: "#262320",
            selectionFill: "rgba(38,35,32,.06)",
        },
        node: {
            label: "#746e66",
            fill: "#efece4",
            panel: "#fffdf8",
            stroke: "#e5e0d7",
            activeStroke: "#262320",
            placeholder: "#96928b",
            text: "#262320",
            muted: "#746e66",
            faint: "#a19d95",
        },
        toolbar: {
            panel: "rgba(255,253,248,.94)",
            border: "#e5e0d7",
            item: "#4a453f",
            itemHover: "#efece4",
            activeBg: "rgba(223,107,72,.12)",
            activeText: "#df6b48",
        },
    },
    dark: {
        canvas: {
            background: "#171513",
            dot: "rgba(244,239,232,.20)",
            line: "rgba(244,239,232,.08)",
            selectionStroke: "#f4efe8",
            selectionFill: "rgba(244,239,232,.10)",
        },
        node: {
            label: "#cec5b9",
            fill: "#25211d",
            panel: "#1f1c18",
            stroke: "#3c3630",
            activeStroke: "#f4efe8",
            placeholder: "#9c9286",
            text: "#f4efe8",
            muted: "#b8aea1",
            faint: "#756c62",
        },
        toolbar: {
            panel: "rgba(38,34,29,.94)",
            border: "#3c3630",
            item: "#d6cdc1",
            itemHover: "#2a2621",
            activeBg: "rgba(229,122,88,.16)",
            activeText: "#f29a76",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
