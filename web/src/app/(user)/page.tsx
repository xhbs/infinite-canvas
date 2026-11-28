"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Sparkles, WandSparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { cn } from "@/lib/utils";
import { uploadAssetMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { AssetPickerModal } from "./canvas/components/asset-picker-modal";
import { CanvasAssistantComposer } from "./canvas/components/canvas-assistant-composer";
import { useCanvasStore } from "./canvas/stores/use-canvas-store";
import { canvasResourceLabel } from "./canvas/utils/canvas-resource-references";
import {
    MAX_CANVAS_AGENT_SKILLS,
    CanvasNodeType,
    type CanvasAgentConfig,
    type CanvasAgentSkillSelection,
    type CanvasAssistantReference,
    type InsertAssetPayload,
    type PendingAgentAsset,
} from "./canvas/types";
import styles from "./home-motion.module.css";

const quickIdeas = [
    { label: "电影感概念分镜", prompt: "为一段雨夜霓虹都市追逐戏生成 4 格电影感分镜草图，包含特写、中景与广角仰拍，冷暖霓虹对比光影" },
    { label: "角色三视图设定", prompt: "生成一名东方机能风少女角色的三视图设定图，包含正面、侧面与背面，干净中灰底色，服饰结构清晰" },
    { label: "琥珀玻璃静物大片", prompt: "为一个琥珀玻璃香水瓶拍摄高级极简静物广告大片，暖金日光透过液体折射出细腻焦散光斑" },
    { label: "日系胶片人像", prompt: "创作一组黄昏海边电车站的日系胶片感人像摄影，柔和逆光发丝与细腻颗粒，低饱和暖色调" },
] as const;

function toPendingAgentAsset(payload: InsertAssetPayload, label: string): PendingAgentAsset {
    const nodeId = nanoid();
    let reference: CanvasAssistantReference;
    if (payload.kind === "text") {
        reference = { id: nodeId, type: CanvasNodeType.Text, title: payload.title, label, text: payload.content };
    } else {
        const common = { id: nodeId, title: payload.title, label, storageKey: payload.storageKey, mimeType: payload.mimeType };
        if (payload.kind === "image") reference = { ...common, type: CanvasNodeType.Image, dataUrl: payload.dataUrl };
        else if (payload.kind === "video") reference = { ...common, type: CanvasNodeType.Video, url: payload.url };
        else reference = { ...common, type: CanvasNodeType.Audio, url: payload.url };
    }
    return { nodeId, payload, reference };
}

export default function IndexPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const reducedMotion = useReducedMotion();
    const effectiveConfig = useEffectiveConfig();
    const createProject = useCanvasStore((state) => state.createProject);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [showcaseIndex, setShowcaseIndex] = useState(0);
    const [showcasePaused, setShowcasePaused] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [composerSeed, setComposerSeed] = useState(0);
    const [pendingAssets, setPendingAssets] = useState<PendingAgentAsset[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<CanvasAgentSkillSelection[]>([]);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [agentConfig, setAgentConfig] = useState<CanvasAgentConfig>(() => ({
        textApiMode: "chat",
        autoGenerateImage: true,
        autoGenerateVideo: false,
        autoGenerateAudio: false,
        imageQuality: effectiveConfig.quality,
        imageSize: effectiveConfig.size,
        videoQuality: effectiveConfig.vquality,
        videoSize: effectiveConfig.videoSize,
    }));
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const pendingAssetCountsRef = useRef<Record<InsertAssetPayload["kind"], number>>({ text: 0, image: 0, video: 0, audio: 0 });

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch(() => setPromptShowcase([]));
    }, []);

    useEffect(() => {
        if (promptShowcase.length < 2 || showcasePaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const timer = window.setInterval(() => setShowcaseIndex((current) => (current + 1) % promptShowcase.length), 6800);
        return () => window.clearInterval(timer);
    }, [promptShowcase.length, showcasePaused]);

    const featuredPrompt = promptShowcase[showcaseIndex];

    const addPendingAsset = (payload: InsertAssetPayload) => {
        const asset = toPendingAgentAsset(payload, canvasResourceLabel(payload.kind, pendingAssetCountsRef.current[payload.kind]++));
        setPendingAssets((current) => [...current, asset]);
        setPrompt((current) => `${current}${current.endsWith(" ") ? "" : " "}${asset.reference.label} `);
    };

    const uploadFile = async (file: File) => {
        try {
            if (file.type.startsWith("image/")) {
                const uploaded = await uploadImage(file);
                addPendingAsset({ kind: "image", dataUrl: uploaded.url, title: file.name, ...uploaded });
            } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                const uploaded = await uploadAssetMediaFile(file);
                if (file.type.startsWith("video/")) addPendingAsset({ kind: "video", title: file.name, ...uploaded });
                else addPendingAsset({ kind: "audio", title: file.name, ...uploaded });
            } else {
                throw new Error("仅支持图片、视频和音频文件");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        }
    };

    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadFile(file);
    };

    const submit = (nextPrompt = prompt, referenceIds = pendingAssets.map((asset) => asset.nodeId)) => {
        const text = nextPrompt.trim();
        if (!text || submitting) return;
        if (!hydrated) {
            message.info("画布数据正在加载，请稍后再试");
            return;
        }
        setSubmitting(true);
        const titles = new Set(useCanvasStore.getState().projects.map(({ title }) => title));
        let title = "无限画布";
        for (let i = 1; titles.has(title); i++) title = `无限画布 ${i}`;
        const projectId = createProject(title, {
            agentConfig,
            pendingAgentRequest: { prompt: text, assets: pendingAssets.filter((asset) => referenceIds.includes(asset.nodeId)), skills: selectedSkills },
        });
        router.push(`/canvas/${projectId}`);
    };

    const selectSkill = (skill: CanvasAgentSkillSelection) => {
        const existingIndex = selectedSkills.findIndex((selected) => selected.id === skill.id && selected.source === skill.source);
        if (existingIndex >= 0) return setSelectedSkills(selectedSkills.map((selected, index) => index === existingIndex ? skill : selected));
        if (selectedSkills.length >= MAX_CANVAS_AGENT_SKILLS) return void message.warning(`最多选择 ${MAX_CANVAS_AGENT_SKILLS} 个 Skill`);
        setSelectedSkills([...selectedSkills, skill]);
    };

    const applyQuickIdea = (ideaPrompt: string) => {
        setPrompt(ideaPrompt);
        setComposerSeed((value) => value + 1);
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
        if (reducedMotion || !mainRef.current) return;
        const rect = mainRef.current.getBoundingClientRect();
        mainRef.current.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        mainRef.current.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };

    return (
        <main
            ref={mainRef}
            onPointerMove={handlePointerMove}
            className={`${styles.home} relative isolate h-full overflow-x-hidden overflow-y-auto bg-background text-foreground`}
        >
            <div aria-hidden="true" className={styles.lightfield} />
            <div aria-hidden="true" className={styles.spotlight} />
            <section className="relative mx-auto max-w-7xl px-4 sm:px-6">
                <section className="relative flex min-h-[min(740px,calc(100svh-4rem))] flex-col items-center justify-center py-14 sm:py-16">
                    <div className={`${styles.badge} mb-7 inline-flex items-center gap-2 rounded-full border border-[var(--brand-accent)]/24 bg-[var(--glass-surface-subtle)] px-3.5 py-1.5 text-xs font-medium tracking-wide text-muted-foreground shadow-[inset_0_1px_0_var(--glass-highlight)] backdrop-blur-[var(--glass-blur)]`}>
                        <span className={styles.badgeDot} aria-hidden="true" />
                        <Sparkles className="size-3.5 text-[var(--brand-accent)]" />
                        <span>欢迎来到无限画布</span>
                    </div>
                    <h1 className={`${styles.title} max-w-4xl text-center text-4xl font-semibold leading-[1.14] tracking-[-0.04em] text-foreground sm:text-5xl md:text-[58px]`}>
                        让每个灵感，<span className="ai-title-aurora inline-block">都有画布。</span>
                    </h1>
                    <p className={`${styles.subtitle} mt-4 max-w-xl px-2 text-center text-sm leading-7 text-muted-foreground sm:text-base`}>
                        从一句描述开始，和 AI 一起把想法铺展开来。图片、视频、素材与 Skill，都可以在这里汇聚。
                    </p>
                    <div className={`${styles.composerWrap} ${styles.composerPulse} mt-9 w-full max-w-[820px] sm:mt-10`}>
                        <CanvasAssistantComposer
                            key={composerSeed}
                            appearance="homepage"
                            initialPrompt={prompt}
                            isRunning={false}
                            references={pendingAssets.map((asset) => asset.reference)}
                            selectedSkills={selectedSkills}
                            agentConfig={agentConfig}
                            onAgentConfigChange={(patch) => setAgentConfig((current) => ({ ...current, ...patch }))}
                            onPromptDraftChange={setPrompt}
                            onReferenceIdsChange={(ids) => setPendingAssets((current) => current.filter((asset) => ids.includes(asset.nodeId)))}
                            onSkillSelect={selectSkill}
                            onSkillRemove={(id, source) => setSelectedSkills((current) => current.filter((skill) => skill.id !== id || skill.source !== source))}
                            onSubmit={submit}
                            onOpenUpload={() => uploadInputRef.current?.click()}
                            onOpenAssets={() => setAssetPickerOpen(true)}
                            onPasteImage={(file) => void uploadFile(file)}
                        />
                    </div>
                    <div className={`${styles.chipRow} mt-3 flex w-full max-w-[820px] flex-wrap items-center justify-center gap-2 px-2`}>
                        {quickIdeas.map((idea, index) => (
                            <motion.button
                                key={idea.label}
                                type="button"
                                whileHover={reducedMotion ? undefined : { y: -2, scale: 1.03 }}
                                whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 420, damping: 26, delay: index * 0.03 }}
                                onClick={() => applyQuickIdea(idea.prompt)}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-surface-subtle)] px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-[inset_0_1px_0_var(--glass-highlight)] backdrop-blur-md transition-colors hover:border-[var(--brand-accent)]/40 hover:bg-[var(--brand-accent-soft)] hover:text-[var(--brand-accent)]"
                            >
                                <WandSparkles className="size-3 text-[var(--brand-accent)]" />
                                <span>{idea.label}</span>
                            </motion.button>
                        ))}
                    </div>
                    <input ref={uploadInputRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={onUploadInputChange} />
                    {featuredPrompt ? (
                        <div className="mt-5 w-full max-w-[820px]">
                            <div
                                className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface)] p-4 shadow-[var(--glass-shadow-soft),inset_0_1px_0_var(--glass-highlight)] backdrop-blur-[var(--glass-blur)] transition-[border-color,box-shadow] duration-[var(--motion-base)] hover:border-[var(--brand-accent)]/30 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
                                onMouseEnter={() => setShowcasePaused(true)}
                                onMouseLeave={() => setShowcasePaused(false)}
                                onFocusCapture={() => setShowcasePaused(true)}
                                onBlurCapture={(event) => {
                                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setShowcasePaused(false);
                                }}
                            >
                                <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand-accent)]/35 to-transparent" />
                                <div className="min-w-0 flex-1">
                                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                        <Sparkles className="size-3.5 text-[var(--brand-accent)]" />
                                        <span>灵感速递</span>
                                        <span className="tabular-nums opacity-55">{String(showcaseIndex + 1).padStart(2, "0")} / {String(promptShowcase.length).padStart(2, "0")}</span>
                                        <span className="ml-auto flex gap-1 sm:hidden">
                                        <button type="button" aria-label="上一条灵感提示词" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50" onClick={() => setShowcaseIndex((showcaseIndex - 1 + promptShowcase.length) % promptShowcase.length)}><ChevronLeft className="size-4" /></button>
                                        <button type="button" aria-label="下一条灵感提示词" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50" onClick={() => setShowcaseIndex((showcaseIndex + 1) % promptShowcase.length)}><ChevronRight className="size-4" /></button>
                                        </span>
                                    </div>
                                    <div key={featuredPrompt.id} className="animate-in fade-in slide-in-from-bottom-1 duration-500 motion-reduce:animate-none">
                                        <h2 className="truncate text-sm font-semibold text-foreground sm:text-base">{featuredPrompt.title}</h2>
                                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground sm:line-clamp-1">{featuredPrompt.prompt}</p>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                                    <div className="hidden items-center gap-1.5 sm:flex">
                                        <button type="button" aria-label="上一条灵感提示词" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50" onClick={() => setShowcaseIndex((showcaseIndex - 1 + promptShowcase.length) % promptShowcase.length)}><ArrowLeft className="size-3.5" /></button>
                                        <button type="button" aria-label="下一条灵感提示词" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50" onClick={() => setShowcaseIndex((showcaseIndex + 1) % promptShowcase.length)}><ArrowRight className="size-3.5" /></button>
                                    </div>
                                    <Button type="text" size="small" className="!h-9 !rounded-full !px-3 !text-[var(--brand-accent)] hover:!bg-[var(--brand-accent)]/[0.08]" icon={<ArrowUpRight className="size-4" />} iconPlacement="end" onClick={() => {
                                        setPreviewIndex(showcaseIndex);
                                        setPreviewOpen(true);
                                    }}>
                                        预览提示词
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </section>

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-[var(--glass-border)] pt-12">
                    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div className="max-w-2xl">
                            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">沉淀每一次好结果</h2>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button href="https://prompts.tdeh.top/" target="_blank">
                                提示词仓库
                            </Button>
                            <Button type="primary" href="/prompts" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                浏览提示词库
                            </Button>
                        </div>
                    </div>
                    {promptShowcase.length ? (
                        <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                            {promptShowcase.map((item, index) => (
                                <div
                                    key={item.id}
                                    style={{ "--fx-index": Math.min(index, 11) } as CSSProperties}
                                    className={cn(
                                        "fx-glass-card fx-rise-in group relative overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-muted text-left shadow-[var(--glass-shadow-soft)]",
                                        index === 0 && "md:col-span-2 md:row-span-2",
                                        index === 3 && "md:col-span-2",
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPreviewIndex(index);
                                            setPreviewOpen(true);
                                        }}
                                        className="block h-full w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/55 focus-visible:ring-inset"
                                    >
                                        <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-4 text-white">
                                            <div className="mb-2 flex flex-wrap gap-1.5">
                                                {item.tags.slice(0, 2).map((tag) => (
                                                    <Tag key={tag} variant="filled" className="m-0 border-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                        {tag}
                                                    </Tag>
                                                ))}
                                            </div>
                                            <h3 className="text-sm font-medium">{item.title}</h3>
                                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            applyQuickIdea(item.prompt);
                                            mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                                        }}
                                        className="absolute right-3 top-3 z-10 inline-flex translate-y-1 cursor-pointer items-center gap-1 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur-md transition-all duration-200 hover:border-[var(--brand-accent)] hover:bg-[var(--brand-accent)] focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
                                    >
                                        <WandSparkles className="size-3" />
                                        复用提示词
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid gap-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-surface-subtle)] p-6 shadow-[var(--glass-shadow-soft),inset_0_1px_0_var(--glass-highlight)] backdrop-blur-[var(--glass-blur)] sm:grid-cols-3">
                            {[
                                {
                                    title: "提示词与参考图",
                                    desc: "统一沉淀可复用的提示词结构、风格参数与成片预览。",
                                    href: "/prompts",
                                    action: "打开提示词库",
                                    graphic: (
                                        <svg viewBox="0 0 220 72" className="h-16 w-full" aria-hidden="true">
                                            <rect x="8" y="10" width="60" height="52" rx="10" fill="var(--brand-accent-soft)" stroke="color-mix(in srgb, var(--brand-accent) 40%, transparent)" />
                                            <rect x="80" y="10" width="60" height="52" rx="10" fill="var(--glass-surface-strong)" stroke="var(--glass-border)" />
                                            <rect x="152" y="10" width="60" height="52" rx="10" fill="var(--glass-surface-strong)" stroke="var(--glass-border)" />
                                            <circle cx="38" cy="36" r="10" fill="var(--brand-accent)" opacity="0.28" />
                                            <path d="M92 28h34 M92 38h24 M164 28h34 M164 38h20" stroke="var(--muted-foreground)" strokeWidth="2.4" strokeLinecap="round" opacity="0.5" />
                                        </svg>
                                    ),
                                },
                                {
                                    title: "生图与视频工作台",
                                    desc: "支持多模型对比、参考图编辑与分镜参数微调。",
                                    href: "/image",
                                    action: "进入生图工作台",
                                    graphic: (
                                        <svg viewBox="0 0 220 72" className="h-16 w-full" aria-hidden="true">
                                            <rect x="8" y="10" width="130" height="52" rx="10" fill="var(--glass-surface-strong)" stroke="var(--glass-border)" />
                                            <rect x="148" y="10" width="64" height="23" rx="7" fill="var(--brand-accent-soft)" stroke="color-mix(in srgb, var(--brand-accent) 40%, transparent)" />
                                            <rect x="148" y="39" width="64" height="23" rx="7" fill="var(--glass-surface-strong)" stroke="var(--glass-border)" />
                                            <path d="M22 46 L52 26 L78 40 L102 22 L124 46" fill="none" stroke="var(--brand-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    ),
                                },
                                {
                                    title: "无限画布协同",
                                    desc: "把文字、草稿、图像与音视频节点自由串联成工作流。",
                                    href: "/canvas",
                                    action: "查看我的画布",
                                    graphic: (
                                        <svg viewBox="0 0 220 72" className="h-16 w-full" aria-hidden="true">
                                            <path className={styles.flowLine} d="M62 36 C86 36, 86 20, 112 20 M62 36 C86 36, 86 52, 112 52 M158 20 C174 20, 174 36, 186 36" fill="none" stroke="var(--brand-accent)" strokeWidth="2" strokeLinecap="round" />
                                            <rect x="10" y="20" width="52" height="32" rx="8" fill="var(--glass-surface-strong)" stroke="var(--glass-border)" />
                                            <rect x="112" y="8" width="46" height="24" rx="7" fill="var(--brand-accent-soft)" stroke="color-mix(in srgb, var(--brand-accent) 45%, transparent)" />
                                            <rect x="112" y="40" width="46" height="24" rx="7" fill="var(--glass-surface-strong)" stroke="var(--glass-border)" />
                                            <rect x="186" y="22" width="24" height="28" rx="7" fill="var(--brand-accent)" opacity="0.26" />
                                        </svg>
                                    ),
                                },
                            ].map((card, index) => (
                                <motion.a
                                    key={card.title}
                                    href={card.href}
                                    initial={reducedMotion ? false : { opacity: 0, y: 18 }}
                                    whileInView={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                                    viewport={{ once: true, amount: 0.25 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 26, delay: index * 0.08 }}
                                    className="fx-glass-card group flex flex-col justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-surface)] p-5 hover:bg-[var(--glass-surface-strong)]"
                                >
                                    <div>
                                        <div className="mb-3 overflow-hidden rounded-lg border border-[var(--glass-border)] bg-[var(--glass-surface-subtle)] p-2 transition-transform duration-300 group-hover:scale-[1.02]">
                                            {card.graphic}
                                        </div>
                                        <h3 className="text-base font-medium text-foreground group-hover:text-[var(--brand-accent)]">{card.title}</h3>
                                        <p className="mt-2 text-xs leading-6 text-muted-foreground">{card.desc}</p>
                                    </div>
                                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-accent)]">
                                        {card.action}
                                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                                    </span>
                                </motion.a>
                            ))}
                        </div>
                    )}
                </section>
            </section>
            <AssetPickerModal
                open={assetPickerOpen}
                defaultTab="my-assets"
                onInsert={(payload) => {
                    addPendingAsset(payload);
                    setAssetPickerOpen(false);
                }}
                onClose={() => setAssetPickerOpen(false)}
            />
            <Image.PreviewGroup
                items={promptShowcase.map((item) => ({
                    src: item.coverUrl,
                    alt: item.title,
                }))}
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            />
        </main>
    );
}
