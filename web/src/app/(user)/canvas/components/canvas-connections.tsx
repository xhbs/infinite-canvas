import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "../types";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;

    return (
        <g className="canvas-conn-group">
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                className="canvas-conn-base"
                d={pathD}
                stroke={active ? "var(--brand-accent)" : "color-mix(in srgb, var(--brand-accent) 44%, var(--muted-foreground))"}
                strokeWidth={active ? 2.8 : 1.75}
                strokeOpacity={active ? 0.96 : 0.76}
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{
                    filter: active ? "drop-shadow(0 0 8px color-mix(in srgb, var(--brand-accent) 55%, transparent))" : undefined,
                    pointerEvents: "none",
                }}
            />
            {active ? (
                <path
                    className="canvas-conn-flow"
                    d={pathD}
                    stroke="var(--glass-glint)"
                    strokeWidth={2}
                    strokeDasharray="6 18"
                    strokeLinecap="round"
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    style={{
                        pointerEvents: "none",
                        animation: "fx-flow-dash 1.1s linear infinite",
                    }}
                />
            ) : (
                <path
                    className="canvas-conn-flow"
                    d={pathD}
                    stroke="var(--brand-accent)"
                    strokeWidth={1.5}
                    strokeOpacity={0.52}
                    strokeDasharray="5 22"
                    strokeLinecap="round"
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    style={{
                        pointerEvents: "none",
                        animation: "fx-flow-dash 2.2s linear infinite",
                    }}
                />
            )}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return (
        <path
            d={pathD}
            stroke="var(--brand-accent)"
            strokeWidth="2.5"
            fill="none"
            strokeDasharray="6 6"
            strokeLinecap="round"
            style={{
                filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--brand-accent) 40%, transparent))",
                animation: "fx-flow-dash 0.8s linear infinite",
            }}
        />
    );
}
