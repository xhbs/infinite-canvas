"use client";

import { App, Input, Modal } from "antd";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { ArrowDown, ArrowUp, ArrowUpRight, Brush, Check, Circle, Download, Eraser, Eye, EyeOff, Highlighter, ImagePlus, Lock, LockOpen, Minus, Pencil, Plus, Redo2, Square, Trash2, Type, Undo2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasDraftDocument, CanvasDraftElement, CanvasDraftLayer, CanvasDraftPoint } from "../types";

type DraftTool = CanvasDraftElement["type"];

type Props = {
    nodeId: string;
    draft?: CanvasDraftDocument;
    previewStorageKey?: string;
    onChange: (draft: CanvasDraftDocument) => void;
    onFinish: (draft: CanvasDraftDocument, image: Blob) => Promise<void>;
    onClose: () => void;
};

const COLOR_SWATCHES = ["#263238", "#d32f2f", "#f57c00", "#fbc02d", "#388e3c", "#1976d2", "#7b1fa2", "#ffffff"];

const RATIOS = [
    { value: "1:1", width: 1024, height: 1024 },
    { value: "3:4", width: 768, height: 1024 },
    { value: "16:9", width: 1280, height: 720 },
    { value: "9:16", width: 720, height: 1280 },
] as const;

const TOOL_OPTIONS: Array<{ value: DraftTool; label: string; Icon: LucideIcon }> = [
    { value: "pencil", label: "铅笔", Icon: Pencil },
    { value: "marker", label: "马克笔", Icon: Highlighter },
    { value: "eraser", label: "橡皮", Icon: Eraser },
    { value: "line", label: "直线", Icon: Minus },
    { value: "arrow", label: "箭头", Icon: ArrowUpRight },
    { value: "rectangle", label: "矩形", Icon: Square },
    { value: "ellipse", label: "椭圆", Icon: Circle },
    { value: "text", label: "文字", Icon: Type },
];

function createLayer(name: string): CanvasDraftLayer {
    return { id: nanoid(), name, visible: true, locked: false, elements: [] };
}

function prepareDraft(draft?: CanvasDraftDocument, previewStorageKey?: string): CanvasDraftDocument {
    const source = draft || { width: 1024, height: 1024, background: "white" as const, completed: false, layers: [] };
    const layers = source.layers.map((layer) => ({ ...layer, elements: [...layer.elements], image: layer.image ? { ...layer.image } : undefined }));
    if (previewStorageKey && !layers.some((layer) => layer.image || layer.elements.length)) {
        layers.push({ ...createLayer("已保存画稿"), image: { storageKey: previewStorageKey, name: "已保存画稿.png", x: 0, y: 0, width: source.width, height: source.height, opacity: 100 } });
    }
    return { ...source, completed: false, layers: layers.length ? layers : [createLayer("图层 1")] };
}

function isPresetRatio(width: number, height: number) {
    return RATIOS.find((ratio) => ratio.width === width && ratio.height === height)?.value || "custom";
}

function scaleLayer(layer: CanvasDraftLayer, scale: number, dx: number, dy: number): CanvasDraftLayer {
    return {
        ...layer,
        image: layer.image ? { ...layer.image, x: layer.image.x * scale + dx, y: layer.image.y * scale + dy, width: layer.image.width * scale, height: layer.image.height * scale } : undefined,
        elements: layer.elements.map((element) => ({
            ...element,
            x: element.x * scale + dx,
            y: element.y * scale + dy,
            endX: element.endX === undefined ? undefined : element.endX * scale + dx,
            endY: element.endY === undefined ? undefined : element.endY * scale + dy,
            size: element.size * scale,
            points: element.points?.map((point) => ({ x: point.x * scale + dx, y: point.y * scale + dy })),
        })),
    };
}

function drawElement(context: CanvasRenderingContext2D, element: CanvasDraftElement) {
    context.save();
    context.globalAlpha = element.type === "eraser" ? 1 : element.opacity / 100;
    context.globalCompositeOperation = element.type === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = element.color;
    context.fillStyle = element.color;
    context.lineWidth = element.size;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (element.type === "text") {
        context.font = `${element.size * 2}px sans-serif`;
        (element.text || "").split("\n").forEach((line, index) => context.fillText(line, element.x, element.y + index * element.size * 2.4));
    } else if (element.points?.length) {
        context.beginPath();
        context.moveTo(element.points[0].x, element.points[0].y);
        element.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        if (element.points.length === 1) context.lineTo(element.points[0].x + 0.1, element.points[0].y + 0.1);
        context.stroke();
    } else if (element.endX !== undefined && element.endY !== undefined) {
        const width = element.endX - element.x;
        const height = element.endY - element.y;
        context.beginPath();
        if (element.type === "rectangle") context.rect(element.x, element.y, width, height);
        else if (element.type === "ellipse") context.ellipse(element.x + width / 2, element.y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
        else {
            context.moveTo(element.x, element.y);
            context.lineTo(element.endX, element.endY);
            context.stroke();
            if (element.type === "arrow") {
                const angle = Math.atan2(height, width);
                const head = Math.max(12, element.size * 3);
                context.beginPath();
                context.moveTo(element.endX, element.endY);
                context.lineTo(element.endX - head * Math.cos(angle - Math.PI / 6), element.endY - head * Math.sin(angle - Math.PI / 6));
                context.moveTo(element.endX, element.endY);
                context.lineTo(element.endX - head * Math.cos(angle + Math.PI / 6), element.endY - head * Math.sin(angle + Math.PI / 6));
                context.stroke();
            }
            context.restore();
            return;
        }
        context.stroke();
    }
    context.restore();
}

function renderDraft(context: CanvasRenderingContext2D, draft: CanvasDraftDocument, imageElements: Record<string, HTMLImageElement>, activeLayerId?: string, activeStroke?: CanvasDraftElement | null, scratch?: HTMLCanvasElement) {
    context.canvas.width = draft.width;
    context.canvas.height = draft.height;
    context.clearRect(0, 0, draft.width, draft.height);
    if (draft.background === "white") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, draft.width, draft.height);
    }
    const layerCanvas = scratch || document.createElement("canvas");
    layerCanvas.width = draft.width;
    layerCanvas.height = draft.height;
    const layerContext = layerCanvas.getContext("2d");
    if (!layerContext) return;

    draft.layers.forEach((layer) => {
        if (!layer.visible) return;
        layerContext.clearRect(0, 0, draft.width, draft.height);
        if (layer.image) {
            const image = imageElements[layer.image.storageKey];
            if (image?.complete && image.naturalWidth) {
                layerContext.globalAlpha = layer.image.opacity / 100;
                layerContext.drawImage(image, layer.image.x, layer.image.y, layer.image.width, layer.image.height);
                layerContext.globalAlpha = 1;
            }
        }
        layer.elements.forEach((element) => drawElement(layerContext, element));
        if (activeStroke && activeLayerId === layer.id) drawElement(layerContext, activeStroke);
        context.drawImage(layerCanvas, 0, 0);
    });
}

function hasArtwork(draft: CanvasDraftDocument) {
    return draft.layers.some((layer) => layer.visible && ((layer.image && layer.image.opacity > 0) || layer.elements.some((element) => {
        if (element.type === "eraser") return false;
        if (element.type === "text") return Boolean(element.text?.trim());
        if (element.points) return element.points.length > 0;
        return element.endX !== undefined && element.endY !== undefined && (element.endX !== element.x || element.endY !== element.y);
    })));
}

async function loadDraftImage(storageKey: string) {
    const src = await resolveImageUrl(storageKey);
    if (!src) throw new Error("图片图层已丢失，请重新导入");
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片图层无法读取，请重新导入"));
        image.src = src;
    });
}

async function draftToBlob(draft: CanvasDraftDocument, imageElements: Record<string, HTMLImageElement>) {
    const resolvedImages = { ...imageElements };
    await Promise.all(draft.layers.flatMap((layer) => {
        const key = layer.image?.storageKey;
        if (!key || resolvedImages[key]?.complete) return [];
        return [loadDraftImage(key).then((image) => { resolvedImages[key] = image; })];
    }));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建画布");
    renderDraft(context, draft, resolvedImages, undefined, undefined, document.createElement("canvas"));
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 导出失败")), "image/png"));
}

export function CanvasDraftEditor({ nodeId, draft, previewStorageKey, onChange, onFinish, onClose }: Props) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [documentState, setDocumentState] = useState(() => prepareDraft(draft, previewStorageKey));
    const [activeLayerId, setActiveLayerId] = useState("");
    const [tool, setTool] = useState<DraftTool>("pencil");
    const [color, setColor] = useState("#263238");
    const [width, setWidth] = useState(4);
    const [opacity, setOpacity] = useState(100);
    const [activeStroke, setActiveStroke] = useState<CanvasDraftElement | null>(null);
    const [textDialogOpen, setTextDialogOpen] = useState(false);
    const [textValue, setTextValue] = useState("");
    const [imageElements, setImageElements] = useState<Record<string, HTMLImageElement>>({});
    const [finishing, setFinishing] = useState(false);
    const [area, setArea] = useState({ width: 680, height: 540 });
    const [customWidth, setCustomWidth] = useState(() => String(documentState.width));
    const [customHeight, setCustomHeight] = useState(() => String(documentState.height));
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scratchRef = useRef<HTMLCanvasElement>(null);
    const areaRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pastRef = useRef<CanvasDraftDocument[]>([]);
    const futureRef = useRef<CanvasDraftDocument[]>([]);
    const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
    const textPositionRef = useRef<CanvasDraftPoint | null>(null);
    const selectedLayerId = documentState.layers.some((layer) => layer.id === activeLayerId) ? activeLayerId : documentState.layers.at(-1)?.id || "";
    const activeLayer = useMemo(() => documentState.layers.find((layer) => layer.id === selectedLayerId), [documentState.layers, selectedLayerId]);
    const ratio = isPresetRatio(documentState.width, documentState.height);
    const canvasScale = Math.max(0.01, Math.min((area.width - 40) / documentState.width, (area.height - 40) / documentState.height, 1));

    const commit = useCallback((next: CanvasDraftDocument) => {
        const updated = { ...next, completed: false };
        pastRef.current = [...pastRef.current.slice(-59), documentState];
        futureRef.current = [];
        setHistoryState({ undo: pastRef.current.length, redo: 0 });
        setDocumentState(updated);
        onChange(updated);
    }, [documentState, onChange]);

    const undo = useCallback(() => {
        const previous = pastRef.current.pop();
        if (!previous) return;
        futureRef.current.push(documentState);
        const updated = { ...previous, completed: false };
        setDocumentState(updated);
        setHistoryState({ undo: pastRef.current.length, redo: futureRef.current.length });
        onChange(updated);
    }, [documentState, onChange]);

    const redo = useCallback(() => {
        const next = futureRef.current.pop();
        if (!next) return;
        pastRef.current.push(documentState);
        const updated = { ...next, completed: false };
        setDocumentState(updated);
        setHistoryState({ undo: pastRef.current.length, redo: futureRef.current.length });
        onChange(updated);
    }, [documentState, onChange]);

    useEffect(() => {
        const element = areaRef.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        scratchRef.current = document.createElement("canvas");
    }, []);

    useEffect(() => {
        let current = true;
        documentState.layers.forEach((layer) => {
            const key = layer.image?.storageKey;
            if (!key || imageElements[key]) return;
            void loadDraftImage(key).then((image) => {
                if (current) setImageElements((elements) => ({ ...elements, [key]: image }));
            }).catch(() => undefined);
        });
        return () => { current = false; };
    }, [documentState.layers, imageElements]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (context) renderDraft(context, documentState, imageElements, selectedLayerId, activeStroke, scratchRef.current || undefined);
    }, [activeStroke, documentState, imageElements, selectedLayerId]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const isTyping = target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLInputElement && !["range", "color"].includes(target.type) || target instanceof HTMLElement && target.isContentEditable;
            if (isTyping || !(event.metaKey || event.ctrlKey)) return;
            if (event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); }
            else if (event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
            else if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [redo, undo]);

    const resizeDocument = (newWidth: number, newHeight: number) => {
        const safeWidth = Math.max(64, Math.min(4096, Math.round(newWidth)));
        const safeHeight = Math.max(64, Math.min(4096, Math.round(newHeight)));
        setCustomWidth(String(safeWidth));
        setCustomHeight(String(safeHeight));
        const scale = Math.min(safeWidth / documentState.width, safeHeight / documentState.height);
        const dx = (safeWidth - documentState.width * scale) / 2;
        const dy = (safeHeight - documentState.height * scale) / 2;
        commit({ ...documentState, width: safeWidth, height: safeHeight, layers: documentState.layers.map((layer) => scaleLayer(layer, scale, dx, dy)) });
    };

    const changeLayer = (layerId: string, update: (layer: CanvasDraftLayer) => CanvasDraftLayer) => {
        commit({ ...documentState, layers: documentState.layers.map((layer) => layer.id === layerId ? update(layer) : layer) });
    };

    const addLayer = () => {
        const layer = createLayer(`图层 ${documentState.layers.length + 1}`);
        commit({ ...documentState, layers: [...documentState.layers, layer] });
        setActiveLayerId(layer.id);
    };

    const importImage = async (file?: File) => {
        if (!file) return;
        try {
            const uploaded = await uploadImage(file);
            const scale = Math.min(documentState.width * 0.72 / uploaded.width, documentState.height * 0.72 / uploaded.height, 1);
            const imageWidth = uploaded.width * scale;
            const imageHeight = uploaded.height * scale;
            const layer: CanvasDraftLayer = {
                ...createLayer(file.name || `图片 ${documentState.layers.length + 1}`),
                image: { storageKey: uploaded.storageKey, name: file.name, x: (documentState.width - imageWidth) / 2, y: (documentState.height - imageHeight) / 2, width: imageWidth, height: imageHeight, opacity: 100 },
            };
            commit({ ...documentState, layers: [...documentState.layers, layer] });
            setActiveLayerId(layer.id);
        } catch (error) {
            message.error(error instanceof Error ? `图片导入失败：${error.message}` : "图片导入失败");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): CanvasDraftPoint => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return { x: (event.clientX - bounds.left) * documentState.width / bounds.width, y: (event.clientY - bounds.top) * documentState.height / bounds.height };
    };

    const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!activeLayer || activeLayer.locked || !activeLayer.visible) return;
        const point = pointFromEvent(event);
        if (tool === "text") {
            textPositionRef.current = point;
            setTextValue("");
            setTextDialogOpen(true);
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        const freehand = tool === "pencil" || tool === "marker" || tool === "eraser";
        setActiveStroke({ id: nanoid(), type: tool, x: point.x, y: point.y, endX: point.x, endY: point.y, ...(freehand ? { points: [point] } : {}), color, size: tool === "marker" ? Math.max(width, 8) : width, opacity });
    };

    const moveDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!activeStroke) return;
        const point = pointFromEvent(event);
        setActiveStroke((stroke) => stroke ? stroke.points ? { ...stroke, points: [...stroke.points, point] } : { ...stroke, endX: point.x, endY: point.y } : null);
    };

    const finishDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!activeStroke || !activeLayer) return;
        const point = pointFromEvent(event);
        const element = activeStroke.points
            ? { ...activeStroke, points: [...activeStroke.points, point] }
            : { ...activeStroke, endX: point.x, endY: point.y };
        setActiveStroke(null);
        changeLayer(activeLayer.id, (layer) => ({ ...layer, elements: [...layer.elements, element] }));
    };

    const downloadPng = async () => {
        try {
            saveAs(await draftToBlob(documentState, imageElements), `草稿-${documentState.width}x${documentState.height}.png`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "PNG 导出失败");
        }
    };

    const finishDraft = async () => {
        setFinishing(true);
        try {
            const finished = { ...documentState, completed: hasArtwork(documentState) };
            await onFinish(finished, await draftToBlob(documentState, imageElements));
            setDocumentState(finished);
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "草稿保存失败");
        } finally {
            setFinishing(false);
        }
    };

    const addText = () => {
        const point = textPositionRef.current;
        if (!activeLayer || !point || !textValue.trim()) return;
        changeLayer(activeLayer.id, (layer) => ({ ...layer, elements: [...layer.elements, { id: nanoid(), type: "text", x: point.x, y: point.y, text: textValue.trim(), color, size: Math.max(width, 10), opacity }] }));
        setTextDialogOpen(false);
    };

    const buttonStyle = (active = false) => ({
        background: active ? "var(--brand-accent-soft)" : "transparent",
        color: active ? "var(--brand-accent)" : theme.toolbar.item,
        border: `1px solid ${active ? "var(--brand-accent)" : "var(--glass-border)"}`,
    });
    const panelStyle = { background: "transparent", color: theme.node.text, borderColor: "var(--glass-border)" };

    return (
        <>
        <Modal className="canvas-glass-modal" open width={1240} footer={null} closable={false} keyboard={!finishing} maskClosable={false} onCancel={onClose} styles={{ body: { padding: 0 } }} style={{ top: 18, maxWidth: "calc(100vw - 28px)" }}>
            <div data-canvas-draft-editor className="flex min-h-[min(780px,82vh)] flex-col overflow-hidden rounded-xl border" style={panelStyle}>
                <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4" style={{ borderColor: theme.toolbar.border }}>
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: "var(--brand-accent-soft)", color: "var(--brand-accent)" }}><Brush className="size-4" /></span>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">画布草稿</div>
                            <div className="text-[10px] opacity-50">{documentState.width} × {documentState.height} px · 图层 {documentState.layers.length}</div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" title="撤销 Ctrl+Z" disabled={!historyState.undo} onClick={undo} className="grid size-8 place-items-center rounded-md disabled:opacity-35" style={buttonStyle()}><Undo2 className="size-4" /></button>
                        <button type="button" title="重做 Ctrl+Shift+Z" disabled={!historyState.redo} onClick={redo} className="grid size-8 place-items-center rounded-md disabled:opacity-35" style={buttonStyle()}><Redo2 className="size-4" /></button>
                        <span className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />
                        <button type="button" onClick={() => void downloadPng()} className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs" style={buttonStyle()}><Download className="size-3.5" />下载 PNG</button>
                        <button type="button" disabled={finishing} onClick={() => void finishDraft()} className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:opacity-50" style={{ background: theme.node.activeStroke, color: theme.node.panel }}><Check className="size-3.5" />{finishing ? "正在保存" : "完成并返回"}</button>
                        <button type="button" title="返回画布" onClick={onClose} className="grid size-8 place-items-center rounded-md" style={buttonStyle()}><X className="size-4" /></button>
                    </div>
                </header>

                <div className="flex min-h-0 flex-1">
                    <aside className="flex w-[62px] shrink-0 flex-col items-center gap-1 border-r py-3" style={{ borderColor: theme.toolbar.border }}>
                        {TOOL_OPTIONS.map(({ value, label, Icon }) => (
                            <button key={value} type="button" title={label} aria-label={label} onClick={() => setTool(value)} className="grid size-10 place-items-center rounded-lg" style={buttonStyle(tool === value)}><Icon className="size-4" /></button>
                        ))}
                        <span className="my-1 h-px w-8" style={{ background: theme.toolbar.border }} />
                        <button type="button" title="导入图片图层" aria-label="导入图片图层" onClick={() => fileInputRef.current?.click()} className="grid size-10 place-items-center rounded-lg" style={buttonStyle()}><ImagePlus className="size-4" /></button>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void importImage(event.target.files?.[0])} />
                    </aside>

                    <section className="flex min-w-0 flex-1 flex-col">
                        <div className="flex min-h-[54px] flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                            <label className="flex items-center gap-2 text-xs opacity-75">画布比例
                                <select value={ratio} onChange={(event) => {
                                    const preset = RATIOS.find((item) => item.value === event.target.value);
                                    if (preset) resizeDocument(preset.width, preset.height);
                                }} className="h-8 rounded-md border px-2 text-xs outline-none" style={panelStyle}>
                                    {RATIOS.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
                                    <option value="custom">自定义</option>
                                </select>
                            </label>
                            {ratio === "custom" ? <div className="flex items-center gap-1 text-xs">
                                <input aria-label="画布宽度" type="number" min={64} max={4096} value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} onBlur={() => resizeDocument(Number(customWidth) || 64, documentState.height)} className="h-8 w-[76px] rounded-md border px-2 outline-none" style={panelStyle} />
                                ×
                                <input aria-label="画布高度" type="number" min={64} max={4096} value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} onBlur={() => resizeDocument(documentState.width, Number(customHeight) || 64)} className="h-8 w-[76px] rounded-md border px-2 outline-none" style={panelStyle} />
                            </div> : null}
                            <button type="button" onClick={() => commit({ ...documentState, background: documentState.background === "white" ? "transparent" : "white" })} className="h-8 rounded-md border px-2.5 text-xs" style={buttonStyle()}>
                                {documentState.background === "white" ? "白色背景" : "透明背景"}
                            </button>
                            <span className="mx-0.5 h-6 w-px" style={{ background: theme.toolbar.border }} />
                            <div className="flex items-center gap-1.5 text-xs opacity-75"><span>颜色</span><div className="flex items-center gap-1">{COLOR_SWATCHES.map((swatch) => <button key={swatch} type="button" aria-label={`选择颜色 ${swatch}`} title={swatch} onClick={() => setColor(swatch)} className="size-4 rounded-full border" style={{ background: swatch, borderColor: color === swatch ? theme.node.activeStroke : theme.toolbar.border, boxShadow: color === swatch ? `0 0 0 1px ${theme.node.activeStroke}` : undefined }} />)}</div><input aria-label="自定义颜色" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" /></div>
                            <label className="flex items-center gap-2 text-xs opacity-75">粗细<input aria-label="笔触粗细" type="range" min={1} max={48} value={width} onChange={(event) => setWidth(Number(event.target.value))} className="w-20 accent-current" /><span className="w-5 tabular-nums">{width}</span></label>
                            <label className="flex items-center gap-2 text-xs opacity-75">不透明<input aria-label="笔触不透明度" type="range" min={10} max={100} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} className="w-20 accent-current" /><span className="w-8 tabular-nums">{opacity}%</span></label>
                        </div>

                        <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-5" style={{ background: theme.canvas.background }}>
                            <div className="relative shrink-0 overflow-hidden shadow-[0_12px_36px_rgba(0,0,0,.22)]" style={{ width: documentState.width * canvasScale, height: documentState.height * canvasScale, background: documentState.background === "white" ? "#fff" : `repeating-conic-gradient(${theme.canvas.background} 0% 25%, ${theme.node.stroke} 0% 50%) 50% / 18px 18px` }}>
                                <canvas ref={canvasRef} tabIndex={0} aria-label="草稿绘图区" className="block h-full w-full touch-none outline-none" style={{ cursor: tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair" }} onPointerDown={(event) => { event.currentTarget.focus({ preventScroll: true }); startDrawing(event); }} onPointerMove={moveDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} />
                            </div>
                            <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] opacity-40">{tool === "text" ? "点击画布放置文字" : "在画布上拖动绘制"}</span>
                        </div>
                    </section>

                    <aside className="flex w-[230px] shrink-0 flex-col border-l" style={{ borderColor: theme.toolbar.border }}>
                        <div className="flex h-[54px] items-center justify-between border-b px-3" style={{ borderColor: theme.toolbar.border }}>
                            <div><div className="text-xs font-semibold">图层</div><div className="text-[10px] opacity-45">上层内容显示在前</div></div>
                            <button type="button" title="添加图层" onClick={addLayer} className="grid size-8 place-items-center rounded-md" style={buttonStyle()}><Plus className="size-4" /></button>
                        </div>
                        <div className="thin-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
                            {documentState.layers.map((layer, index) => (
                                <div key={layer.id} className="rounded-lg border p-2" style={{ background: selectedLayerId === layer.id ? "var(--brand-accent-soft)" : "transparent", borderColor: selectedLayerId === layer.id ? "var(--brand-accent)" : "var(--glass-border)" }} onClick={() => setActiveLayerId(layer.id)}>
                                    <input aria-label="图层名称" value={layer.name} onChange={(event) => changeLayer(layer.id, (current) => ({ ...current, name: event.target.value }))} className="mb-2 h-7 w-full rounded border px-2 text-xs outline-none" style={panelStyle} />
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-0.5">
                                            <button type="button" title={layer.visible ? "隐藏图层" : "显示图层"} onClick={(event) => { event.stopPropagation(); changeLayer(layer.id, (current) => ({ ...current, visible: !current.visible })); }} className="grid size-7 place-items-center rounded" style={buttonStyle()}>{layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</button>
                                            <button type="button" title={layer.locked ? "解锁图层" : "锁定图层"} onClick={(event) => { event.stopPropagation(); changeLayer(layer.id, (current) => ({ ...current, locked: !current.locked })); }} className="grid size-7 place-items-center rounded" style={buttonStyle()}>{layer.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}</button>
                                            <button type="button" title="上移图层" disabled={index === documentState.layers.length - 1} onClick={(event) => { event.stopPropagation(); const next = [...documentState.layers]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commit({ ...documentState, layers: next }); }} className="grid size-7 place-items-center rounded disabled:opacity-30" style={buttonStyle()}><ArrowUp className="size-3.5" /></button>
                                            <button type="button" title="下移图层" disabled={index === 0} onClick={(event) => { event.stopPropagation(); const next = [...documentState.layers]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; commit({ ...documentState, layers: next }); }} className="grid size-7 place-items-center rounded disabled:opacity-30" style={buttonStyle()}><ArrowDown className="size-3.5" /></button>
                                        </div>
                                        <button type="button" title="删除图层" disabled={documentState.layers.length < 2} onClick={(event) => {
                                            event.stopPropagation();
                                            const next = documentState.layers.filter((item) => item.id !== layer.id);
                                            commit({ ...documentState, layers: next });
                                            if (activeLayerId === layer.id) setActiveLayerId(next.at(-1)?.id || "");
                                        }} className="grid size-7 place-items-center rounded disabled:opacity-30" style={{ color: theme.node.muted }}><Trash2 className="size-3.5" /></button>
                                    </div>
                                    {layer.image ? <div className="mt-1 truncate text-[10px] opacity-45" title={layer.image.name}>{layer.image.name}</div> : null}
                                </div>
                            ))}
                        </div>
                        <div className="border-t px-3 py-2 text-[10px] opacity-45" style={{ borderColor: theme.toolbar.border }}>图层锁定后不可绘制 · 调整画布尺寸会居中保留内容</div>
                    </aside>
                </div>
            </div>
            <span className="sr-only">草稿编辑器 {nodeId}</span>
        </Modal>
        <Modal className="canvas-glass-modal" open={textDialogOpen} title="添加文字" okText="添加到画布" cancelText="取消" onOk={addText} onCancel={() => setTextDialogOpen(false)}>
            <Input.TextArea autoFocus autoSize={{ minRows: 2, maxRows: 6 }} maxLength={500} value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="输入草稿中的文字或标注" />
        </Modal>
        </>
    );
}
