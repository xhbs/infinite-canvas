"use client";

import { memo } from "react";
import { ArrowUpRight, Check, Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { CanvasNodeType } from "../types";
import { exportCanvasProjects } from "../utils/canvas-export";

const CanvasProjectPreview = memo(function CanvasProjectPreview({ nodes, connections }: Pick<CanvasProject, "nodes" | "connections">) {
    const count = Math.min(nodes.length, 36);
    const sample = Array.from({ length: count }, (_, index) => nodes[Math.floor(index * nodes.length / count)]).filter(
        ({ position, width, height }) => Number.isFinite(position?.x) && Number.isFinite(position?.y) && width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height),
    );

    if (!sample.length) {
        return (
            <div className="canvas-project-preview-graphic absolute inset-0 grid place-items-center" aria-hidden="true">
                <span className="canvas-project-preview-empty grid h-14 w-20 place-items-center rounded-xl border border-dashed">
                    <Plus className="size-5" />
                </span>
            </div>
        );
    }

    const left = Math.min(...sample.map((node) => node.position.x));
    const top = Math.min(...sample.map((node) => node.position.y));
    const width = Math.max(...sample.map((node) => node.position.x + node.width)) - left;
    const height = Math.max(...sample.map((node) => node.position.y + node.height)) - top;
    const scale = Math.min(0.24, 248 / width, 104 / height);
    const offsetX = (320 - width * scale) / 2;
    const offsetY = (160 - height * scale) / 2;
    const tiles = sample.map((node) => ({
        id: node.id,
        type: node.type,
        x: Math.round((node.position.x - left) * scale + offsetX),
        y: Math.round((node.position.y - top) * scale + offsetY),
        width: Math.max(3, Math.round(node.width * scale)),
        height: Math.max(3, Math.round(node.height * scale)),
    }));
    const byId = new Map(tiles.map((tile) => [tile.id, tile]));
    const paths: string[] = [];
    for (const connection of connections.slice(0, 144)) {
        const from = byId.get(connection.fromNodeId);
        const to = byId.get(connection.toNodeId);
        if (!from || !to) continue;
        const startX = from.x + from.width;
        const startY = Math.round(from.y + from.height / 2);
        const endY = Math.round(to.y + to.height / 2);
        const bend = Math.max(8, Math.round(Math.abs(to.x - startX) * 0.42));
        paths.push(`M${startX},${startY} C${startX + bend},${startY} ${to.x - bend},${endY} ${to.x},${endY}`);
        if (paths.length === 48) break;
    }

    return (
        <div className="canvas-project-preview-graphic absolute inset-0" aria-hidden="true">
            <svg viewBox="0 0 320 160" className="size-full">
                {tiles.filter((tile) => tile.type === CanvasNodeType.Group).map(({ id, type, ...rect }) => (
                    <rect key={id} className="canvas-project-preview-group" rx={4} {...rect} />
                ))}
                {paths.length ? <path className="canvas-project-preview-links" d={paths.join(" ")} fill="none" /> : null}
                {tiles.filter((tile) => tile.type !== CanvasNodeType.Group).map(({ id, type, ...rect }) => (
                    <g key={id} className="canvas-project-preview-node" data-kind={type}>
                        <rect rx={Math.min(5, rect.width / 4, rect.height / 4)} {...rect} />
                        {rect.width >= 24 && rect.height >= 18 ? (
                            <path d={`M${rect.x + 7} ${rect.y + 7}h${Math.round(rect.width * 0.42)} M${rect.x + 7} ${rect.y + 13}h${Math.round(rect.width * 0.28)}`} opacity="0.65" strokeLinecap="round" />
                        ) : null}
                    </g>
                ))}
            </svg>
        </div>
    );
});

export const CanvasProjectCard = memo(function CanvasProjectCard({ project, index }: { project: CanvasProject; index: number }) {
    const router = useRouter();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selected = useCanvasUiStore((state) => state.selectedProjectIds.includes(project.id));
    const editing = useCanvasUiStore((state) => state.editingProjectId === project.id);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectId === project.id ? state.editingProjectTitle : "");
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const open = () => router.push(`/canvas/${project.id}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article
            className={`canvas-project-card min-w-0 rounded-2xl p-2 ${editing ? "" : "cursor-pointer"}`}
            data-selected={selected}
            style={{ animationDelay: `${Math.min(index, 12) * 55}ms` }}
            onClick={() => !editing && open()}
        >
            <div className="canvas-project-preview relative overflow-hidden rounded-xl border border-[var(--glass-border)]">
                <CanvasProjectPreview nodes={project.nodes} connections={project.connections} />
                <label className="absolute top-2.5 left-2.5 z-10 grid size-8 cursor-pointer place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-surface-strong)]" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={selected} onChange={(event) => toggleSelected(project.id, event.target.checked)} className="size-4 cursor-pointer accent-[var(--brand-accent)]" aria-label={`选择 ${project.title}`} />
                </label>
                {!editing ? (
                    <span className="canvas-project-open absolute top-2.5 right-2.5 z-10 grid size-8 place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-surface-strong)] text-muted-foreground" aria-hidden="true">
                        <ArrowUpRight className="size-4" />
                    </span>
                ) : null}
                <span className="absolute bottom-2.5 left-2.5 z-10 rounded-md border border-[var(--glass-border)] bg-[var(--glass-surface-strong)] px-2 py-0.5 text-xs text-muted-foreground" aria-hidden="true">
                    {project.nodes.length ? "布局预览" : "空白画布"}
                </span>
            </div>
            <div className="px-3 pt-3 pb-1">
                {editing ? (
                    <Input aria-label="画布名称" className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <h2 className="text-lg font-semibold">
                        <button type="button" className="block w-full cursor-pointer truncate text-left" title={project.title} onClick={(event) => { event.stopPropagation(); open(); }}>
                            {project.title}
                        </button>
                    </h2>
                )}
                <p className="mt-1.5 text-sm text-muted-foreground">{project.nodes.length} 个节点 · {project.connections.length} 条连线</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--glass-border)] pt-2.5">
                    <p className="text-xs text-muted-foreground">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        {editing ? (
                            <>
                                <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
                                <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
                            </>
                        ) : (
                            <>
                                <Button type="text" size="small" shape="circle" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || "无限画布")} aria-label="导出" />
                                <Button type="text" size="small" shape="circle" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label="重命名" />
                                <Button type="text" size="small" shape="circle" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label="删除" />
                            </>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
});
