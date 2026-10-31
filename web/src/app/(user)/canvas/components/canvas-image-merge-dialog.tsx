"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "antd";
import { GripVertical, Images } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { defaultImageGridLayout, IMAGE_GRID_LAYOUTS, mergeImageCellAspect, type ImageGridLayout, type MergeImage } from "../utils/canvas-image-data";

export function CanvasImageMergeDialog({ images, open, busy, onClose, onConfirm }: { images: MergeImage[]; open: boolean; busy: boolean; onClose: () => void; onConfirm: (images: MergeImage[], layout: ImageGridLayout) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [orderedImages, setOrderedImages] = useState(images);
    const [layout, setLayout] = useState<ImageGridLayout>(() => defaultImageGridLayout(images.length));
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [previewBounds, setPreviewBounds] = useState({ width: 900, height: 480 });

    useEffect(() => {
        const resize = () => setPreviewBounds({ width: Math.min(920, window.innerWidth - 64), height: window.innerHeight * 0.48 });
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    useEffect(() => {
        if (open) {
            setOrderedImages(images);
            setLayout(defaultImageGridLayout(images.length));
        }
    }, [images, open]);

    const moveImage = (targetId: string) => {
        if (!draggingId || draggingId === targetId) return;
        setOrderedImages((current) => {
            const next = [...current];
            const from = next.findIndex((image) => image.id === draggingId);
            const to = next.findIndex((image) => image.id === targetId);
            if (from < 0 || to < 0) return current;
            next.splice(to, 0, next.splice(from, 1)[0]);
            return next;
        });
    };

    const capacity = layout.columns * layout.rows;
    const cellAspect = mergeImageCellAspect(orderedImages);
    const previewAspect = layout.columns * cellAspect / layout.rows;
    const previewWidth = Math.min(previewBounds.width, previewBounds.height * previewAspect);
    const slots = Array.from({ length: capacity }, (_, index) => orderedImages[index]);

    return (
        <Modal title={null} open={open} onCancel={onClose} footer={null} width="min(1040px, calc(100vw - 24px))" centered destroyOnHidden>
            <div className="space-y-4">
                <header className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-semibold" style={{ color: theme.node.text }}>合并图片</h2>
                        <p className="mt-1 text-sm opacity-60">选择列数和行数，拖动图片调整顺序；图片按比例完整放入格子，不会裁切。</p>
                    </div>
                    <span className="text-xs tabular-nums opacity-55">已选 {orderedImages.length} 张 · 当前 {layout.columns} × {layout.rows} 共 {capacity} 格</span>
                </header>
                <div className="flex flex-wrap gap-2">
                    {IMAGE_GRID_LAYOUTS.filter((item) => item.columns * item.rows >= orderedImages.length).map((item) => {
                        const active = item.columns === layout.columns && item.rows === layout.rows;
                        return (
                            <button key={`${item.columns}x${item.rows}`} type="button" disabled={busy} onClick={() => setLayout(item)} className="flex h-10 items-center gap-2 rounded-lg border px-2.5 text-xs transition hover:opacity-85 disabled:opacity-50" style={{ background: active ? theme.toolbar.activeBg : theme.toolbar.panel, borderColor: active ? theme.toolbar.activeText : theme.toolbar.border, color: active ? theme.toolbar.activeText : theme.node.text }}>
                                <LayoutGlyph layout={item} active={active} />
                                <span className="tabular-nums">{item.columns} × {item.rows}</span>
                                <span className="opacity-55">{item.columns * item.rows} 格</span>
                            </button>
                        );
                    })}
                </div>
                <div className="grid max-h-[54vh] min-h-44 place-items-center overflow-auto rounded-lg border p-1" style={{ background: "#34383a", borderColor: "#34383a" }}>
                    <div className="grid max-w-full gap-1" style={{ width: previewWidth, gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`, aspectRatio: `${layout.columns * cellAspect} / ${layout.rows}` }}>
                        {slots.map((image, index) => (
                            <div
                                key={image?.id || `empty-${index}`}
                                draggable={Boolean(image) && !busy}
                                onDragStart={(event) => {
                                    if (!image) return;
                                    setDraggingId(image.id);
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData("text/plain", image.id);
                                }}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => { event.preventDefault(); if (image) moveImage(image.id); setDraggingId(null); }}
                                onDragEnd={() => setDraggingId(null)}
                                title={image?.title || "留白"}
                                className="group relative min-h-0 min-w-0 overflow-hidden"
                                style={{ background: "#f3f3f0", opacity: image && draggingId === image.id ? 0.45 : 1 }}
                            >
                                {image ? <img src={image.src} alt={image.title} draggable={false} className="size-full object-contain p-1" /> : <span className="grid size-full place-items-center text-xs opacity-30">留白</span>}
                                <span className="absolute left-1 top-1 grid size-5 place-items-center rounded text-[10px] font-semibold shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{index + 1}</span>
                                {image ? <GripVertical className="absolute right-1 top-1 size-4 rounded bg-black/50 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100" /> : null}
                            </div>
                        ))}
                    </div>
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <span className="text-xs opacity-55">在本地浏览器完成合成，不调用 AI；多余格子会留白。</span>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose} disabled={busy}>取消</Button>
                        <Button type="primary" icon={<Images className="size-4" />} loading={busy} disabled={orderedImages.length < 2 || orderedImages.length > capacity} onClick={() => onConfirm(orderedImages, layout)}>生成并添加节点</Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function LayoutGlyph({ layout, active }: { layout: ImageGridLayout; active: boolean }) {
    return <span className="grid size-4 gap-px" style={{ gridTemplateColumns: `repeat(${layout.columns}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }} aria-hidden="true">{Array.from({ length: layout.columns * layout.rows }).map((_, index) => <span key={index} className="rounded-[1px]" style={{ background: "currentColor", opacity: active ? 0.9 : 0.6 }} />)}</span>;
}
