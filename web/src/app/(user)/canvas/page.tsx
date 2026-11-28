"use client";

import "./canvas-glass.css";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { App, Button } from "antd";
import { Download, FileUp, Layers3, Plus } from "lucide-react";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "./components/canvas-project-card";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";
import { exportCanvasProjects } from "./utils/canvas-export";

export default function CanvasPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const enterProject = (id: string) => {
        router.push(`/canvas/${id}`);
    };
    const createAndEnter = () => enterProject(createProject(`无限画布 ${projects.length + 1}`));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return (
        <main className="canvas-ui canvas-library fx-ambient-stage h-full overflow-auto text-foreground">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="canvas-library-header flex flex-wrap items-end justify-between gap-4 border-b border-[var(--glass-border)] pb-6">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
                            <Layers3 aria-hidden="true" className="size-4 text-[var(--brand-accent)]" />
                            <span>灵感与创作</span>
                            <span className="canvas-library-live-indicator" aria-hidden="true" />
                        </div>
                        <h1 className="mt-2 text-3xl font-semibold">无限画布</h1>
                        <p className="mt-2 text-sm text-muted-foreground">{projects.length ? `把灵感、草稿和创作过程，收进每一张画布。 · ${projects.length} 个作品` : "从一张空白画布开始，收集灵感、绘制草稿、串起创作过程。"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `无限画布-${selectedIds.length}个项目`)}>
                                    导出选中
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                删除全部
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入画布
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            新建画布
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[340px] items-center justify-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface-subtle)] text-sm text-muted-foreground backdrop-blur-[var(--glass-blur)]">正在加载画布...</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project, index) => (
                            <CanvasProjectCard key={project.id} project={project} index={index} />
                        ))}
                    </div>
                ) : (
                    <section className="fx-rise-in flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--glass-border-strong)] bg-[var(--glass-surface-subtle)] px-6 py-12 text-center shadow-[var(--glass-shadow-soft),inset_0_1px_0_var(--glass-highlight)] backdrop-blur-[var(--glass-blur)]">
                        <div className="mb-4 grid size-13 place-items-center rounded-2xl border border-[var(--brand-accent)]/30 bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] shadow-[0_8px_24px_color-mix(in_srgb,var(--brand-accent)_14%,transparent)] transition-transform duration-300 hover:scale-105">
                            <Layers3 className="size-6" />
                        </div>
                        <h2 className="text-xl font-semibold text-foreground">还没有画布</h2>
                        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">新建一个画布后，就可以独立保存节点、连线和画布外观。</p>
                        <Button type="primary" className="fx-btn-glint mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            新建画布
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
