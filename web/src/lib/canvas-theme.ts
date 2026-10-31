export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f6f5f1",
            dot: "rgba(112,105,92,.18)",
            line: "rgba(112,105,92,.08)",
            selectionStroke: "#292826",
            selectionFill: "rgba(41,40,38,.06)",
        },
        node: {
            label: "#6e6b64",
            fill: "#f0eee8",
            panel: "#fffefa",
            stroke: "#e6e3dc",
            activeStroke: "#292826",
            placeholder: "#96928b",
            text: "#292826",
            muted: "#77736b",
            faint: "#a19d95",
        },
        toolbar: {
            panel: "rgba(255,254,250,.97)",
            border: "#e6e3dc",
            item: "#4c4a45",
            itemHover: "#f0eee8",
            activeBg: "#fff0e8",
            activeText: "#df6b48",
        },
    },
    dark: {
        canvas: {
            background: "#181715",
            dot: "rgba(245,245,244,.24)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#fafaf9",
            selectionFill: "rgba(250,250,249,.10)",
        },
        node: {
            label: "#d6d3d1",
            fill: "#292524",
            panel: "#1f1d1a",
            stroke: "#44403c",
            activeStroke: "#fafaf9",
            placeholder: "#a8a29e",
            text: "#f5f5f4",
            muted: "#d6d3d1",
            faint: "#78716c",
        },
        toolbar: {
            panel: "rgba(31,29,26,.96)",
            border: "#44403c",
            item: "#d6d3d1",
            itemHover: "#292524",
            activeBg: "#3a3631",
            activeText: "#f5f5f4",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
