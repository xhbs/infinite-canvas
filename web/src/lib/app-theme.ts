import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#262320",
        primaryHover: "#3d3833",
        primaryText: "#fffdf8",
        menuBg: "#efece4",
        menuText: "#262320",
        selectActiveBg: "#efece4",
        selectSelectedBg: "#fff0e8",
        selectText: "#262320",
        tableSelectedBg: "rgba(223, 107, 72, 0.09)",
        tableSelectedHoverBg: "rgba(223, 107, 72, 0.14)",
    },
    dark: {
        primary: "#f4efe8",
        primaryHover: "#fffdf8",
        primaryText: "#171513",
        menuBg: "#2a2621",
        menuText: "#f4efe8",
        selectActiveBg: "#2a2621",
        selectSelectedBg: "rgba(229, 122, 88, 0.16)",
        selectText: "#f7b398",
        tableSelectedBg: "rgba(229, 122, 88, 0.11)",
        tableSelectedHoverBg: "rgba(229, 122, 88, 0.16)",
    },
};

export const adminLayoutStyle = {
    siderWidth: 232,
    headerHeight: 56,
    brandHeight: 56,
    menu: { borderInlineEnd: 0, padding: "18px 12px", fontSize: 15 } satisfies CSSProperties,
    menuItem: { height: 44, lineHeight: "44px", marginBlock: 4, borderRadius: 8 } satisfies CSSProperties,
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            borderRadius: 10,
            borderRadiusLG: 14,
            ...(dark
                ? {
                      colorBgLayout: "#171513",
                      colorBgContainer: "#211e1a",
                      colorBgElevated: "#26221d",
                      colorBorder: "rgba(255, 244, 229, 0.1)",
                      colorBorderSecondary: "rgba(255, 244, 229, 0.07)",
                      colorText: "#f4efe8",
                      colorTextSecondary: "#a89e92",
                      colorFillTertiary: "#2a2621",
                      controlOutline: "rgba(229, 122, 88, 0.24)",
                  }
                : {
                      colorBgLayout: "#f7f5f0",
                      colorBgContainer: "#fffdf8",
                      colorBgElevated: "#fffdf8",
                      colorBorder: "rgba(41, 37, 32, 0.1)",
                      colorBorderSecondary: "rgba(41, 37, 32, 0.06)",
                      colorText: "#262320",
                      colorTextSecondary: "#746e66",
                      colorFillTertiary: "#efece4",
                      controlOutline: "rgba(223, 107, 72, 0.2)",
                  }),
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
