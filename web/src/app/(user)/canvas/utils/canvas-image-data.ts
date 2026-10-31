"use client";

import { getProxyUrl } from "@/services/image-storage";

export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageAngleTransform = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";

export const MAX_UPSCALE_LONG_EDGE = 4096;

export type ImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: ImageUpscaleAlgorithm;
};

export type ImageSplitParams = {
    horizontalLines: number[];
    verticalLines: number[];
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

export type MergeImage = {
    id: string;
    title: string;
    src: string;
    storageKey?: string;
    width?: number;
    height?: number;
};

export type ImageGridLayout = { columns: number; rows: number };

export const IMAGE_GRID_LAYOUTS: ImageGridLayout[] = [
    { columns: 2, rows: 1 }, { columns: 1, rows: 2 },
    { columns: 2, rows: 2 }, { columns: 3, rows: 2 }, { columns: 2, rows: 3 },
    { columns: 4, rows: 2 }, { columns: 2, rows: 4 }, { columns: 3, rows: 3 },
    { columns: 4, rows: 3 }, { columns: 3, rows: 4 }, { columns: 5, rows: 3 },
    { columns: 3, rows: 5 }, { columns: 4, rows: 4 }, { columns: 5, rows: 4 },
    { columns: 4, rows: 5 }, { columns: 5, rows: 5 },
];

export function defaultImageGridLayout(imageCount: number) {
    return [...IMAGE_GRID_LAYOUTS]
        .filter((layout) => layout.columns * layout.rows >= imageCount)
        .sort((a, b) => a.columns * a.rows - b.columns * b.rows || Math.abs(a.columns - a.rows) - Math.abs(b.columns - b.rows) || b.columns - a.columns)[0] || IMAGE_GRID_LAYOUTS[IMAGE_GRID_LAYOUTS.length - 1];
}

export function orderMergeImages(images: MergeImage[], nodes: Array<{ id: string; position: { x: number; y: number }; height: number }>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const medianHeight = [...nodes].map((node) => node.height).sort((a, b) => a - b)[Math.floor(nodes.length / 2)] || 1;
    const rows: Array<{ y: number; images: MergeImage[] }> = [];

    images
        .map((image) => ({ image, node: nodeById.get(image.id) }))
        .filter((item): item is { image: MergeImage; node: { id: string; position: { x: number; y: number }; height: number } } => Boolean(item.node))
        .sort((a, b) => a.node.position.y - b.node.position.y)
        .forEach(({ image, node }) => {
            let row = rows.find((item) => Math.abs(item.y - node.position.y) <= medianHeight * 0.6);
            if (!row) rows.push((row = { y: node.position.y, images: [] }));
            row.images.push(image);
        });

    return rows.flatMap((row) => row.images.sort((a, b) => (nodeById.get(a.id)?.position.x || 0) - (nodeById.get(b.id)?.position.x || 0)));
}

export function mergeImageCellAspect(images: MergeImage[]) {
    const ratios = images.filter((image) => image.width && image.height).map((image) => image.width! / image.height!).sort((a, b) => a - b);
    return ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
}

export async function composeImageGrid(images: MergeImage[], layout: ImageGridLayout) {
    const { columns, rows } = layout;
    if (images.length < 2 || images.length > columns * rows) throw new Error("图片数量与合并比例不匹配");
    const loaded = await Promise.all(images.map((item) => loadImage(item.src)));
    const cellAspect = mergeImageCellAspect(images);
    const gap = 4;
    const frame = 4;
    const cellWidth = Math.floor(Math.min(
        (4096 - frame * 2 - gap * (columns - 1)) / columns,
        (4096 - frame * 2 - gap * (rows - 1)) * cellAspect / rows,
    ));
    const cellHeight = Math.max(1, Math.floor(cellWidth / cellAspect));
    const canvas = document.createElement("canvas");
    canvas.width = cellWidth * columns + gap * (columns - 1) + frame * 2;
    canvas.height = cellHeight * rows + gap * (rows - 1) + frame * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.fillStyle = "#34383a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    loaded.forEach((image, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = frame + column * (cellWidth + gap);
        const y = frame + row * (cellHeight + gap);
        context.fillStyle = "#f3f3f0";
        context.fillRect(x, y, cellWidth, cellHeight);
        const inset = 4;
        const scale = Math.min((cellWidth - inset * 2) / image.width, (cellHeight - inset * 2) / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, x + (cellWidth - width) / 2, y + (cellHeight - height) / 2, width, height);
    });

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("合并图片导出失败")), "image/png");
    });
}

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const xCuts = buildSplitCuts(params.verticalLines, image.width);
    const yCuts = buildSplitCuts(params.horizontalLines, image.height);
    const pieces: ImageSplitPiece[] = [];

    for (let row = 0; row < yCuts.length - 1; row += 1) {
        const sy = yCuts[row];
        const sh = yCuts[row + 1] - sy;
        for (let column = 0; column < xCuts.length - 1; column += 1) {
            const sx = xCuts[column];
            const sw = xCuts[column + 1] - sx;
            pieces.push({ row, column, dataUrl: drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

function buildSplitCuts(lines: number[], size: number) {
    return [0, ...lines.map((line) => Math.round(line * size)).filter((line) => line > 0 && line < size).sort((a, b) => a - b), size];
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const padding = Math.round(Math.max(image.width, image.height) * 0.18);
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const horizontal = params.horizontalAngle / 60;
    const pitch = params.pitchAngle / 45;
    const distanceScale = 1.12 - params.cameraDistance * 0.035;
    const wideScale = params.wideAngle ? 0.88 : 1;
    const scale = Math.max(0.64, Math.min(1.1, distanceScale * wideScale));
    const width = image.width * scale * (1 - Math.abs(horizontal) * 0.28);
    const height = image.height * scale * (1 - Math.abs(pitch) * 0.18);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const skewX = horizontal * image.width * 0.18;
    const skewY = pitch * image.height * 0.12;
    const x = cx - width / 2 + horizontal * padding * 0.5;
    const y = cy - height / 2 + pitch * padding * 0.45;

    context.save();
    context.setTransform(1, pitch * 0.08, horizontal * -0.1, 1, 0, 0);
    context.drawImage(image, x + skewX, y + skewY, width, height);
    context.restore();

    if (params.wideAngle) {
        const gradient = context.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.2, cx, cy, Math.max(canvas.width, canvas.height) * 0.62);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.18)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    return params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResize(image, image.width, image.height, width, height, params.algorithm);
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) return image.src;
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResize(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResize(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, algorithm).toDataURL("image/png");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        let src = dataUrl;
        if (dataUrl.startsWith("http")) {
            src = getProxyUrl(dataUrl);
            image.crossOrigin = "anonymous";
        }
        image.onload = () => resolve(image);
        image.onerror = (err) => reject(err);
        image.src = src;
    });
}
