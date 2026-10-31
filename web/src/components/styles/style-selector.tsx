"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Popconfirm, Select, Spin, Tag } from "antd";
import { Check, ChevronRight, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";

import { useStyleStore } from "@/stores/use-style-store";
import { useUserStore } from "@/stores/use-user-store";
import type { GenerationStyle } from "@/services/api/styles";

type StyleSelectorProps = {
    type: "image" | "video";
    value?: string;
    onChange: (style?: GenerationStyle) => void;
    className?: string;
    buttonClassName?: string;
    compact?: boolean;
    valueName?: string;
};

const scopeLabel = (scope: GenerationStyle["appliesTo"]) => scope === "both" ? "图片 · 视频" : scope === "image" ? "图片" : "视频";

export function StyleSelector({ type, value, onChange, className, buttonClassName, compact = false, valueName }: StyleSelectorProps) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const { styles, isLoading, load, save, remove } = useStyleStore();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Partial<GenerationStyle> | null>(null);
    const [name, setName] = useState("");
    const [prompt, setPrompt] = useState("");
    const [keyword, setKeyword] = useState("");
    const [appliesTo, setAppliesTo] = useState<GenerationStyle["appliesTo"]>("both");
    const [isSaving, setIsSaving] = useState(false);
    const available = useMemo(() => styles.filter((style) => (style.appliesTo === type || style.appliesTo === "both") && `${style.name} ${style.prompt}`.toLowerCase().includes(keyword.trim().toLowerCase())), [keyword, styles, type]);
    const selected = styles.find((style) => style.id === value);

    useEffect(() => {
        if (token) void load().catch((error) => message.error(error instanceof Error ? error.message : "获取风格失败"));
    }, [load, message, token]);

    const beginEdit = (style?: GenerationStyle) => {
        setEditing(style || {});
        setName(style?.name || "");
        setPrompt(style?.prompt || "");
        setAppliesTo(style?.appliesTo || "both");
    };

    const submitEdit = async () => {
        if (!name.trim() || !prompt.trim()) return message.warning("请填写风格名称和描述");
        setIsSaving(true);
        try {
            const style = await save({ ...editing, name, prompt, appliesTo });
            setEditing(null);
            message.success("风格已保存");
            if (!value || value === style.id) onChange(style);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存风格失败");
        } finally {
            setIsSaving(false);
        }
    };

    const deleteStyle = async (style: GenerationStyle) => {
        try {
            await remove(style.id);
            if (style.id === value) onChange(undefined);
            message.success("风格已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除风格失败");
        }
    };

    return <>
        <Button className={buttonClassName} aria-label={compact ? selected || valueName ? `风格：${selected?.name || valueName}` : "选择风格" : undefined} title={compact ? selected || valueName ? `风格：${selected?.name || valueName}` : "选择风格" : undefined} onClick={() => token ? setOpen(true) : message.info("请先登录后使用风格库")}>
            {compact ? <Sparkles className={`size-4 ${selected || valueName ? "text-amber-500" : ""}`} /> : selected ? <span className="inline-flex max-w-44 items-center gap-1.5"><Sparkles className="size-3.5 shrink-0" /><span className="truncate">{selected.name}</span></span> : "选择风格"}
        </Button>
        <Modal
            title={null}
            open={open}
            onCancel={() => { setOpen(false); setEditing(null); }}
            footer={null}
            width="min(780px, calc(100vw - 24px))"
            centered
            destroyOnHidden
            styles={{ body: { padding: 0 } }}
        >
            {editing ? <div className="p-5 sm:p-7">
                <div className="mb-6 flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600"><Sparkles className="size-5" /></div>
                    <div className="min-w-0 flex-1">
                        <div className="text-lg font-semibold tracking-tight">{editing.id ? "编辑风格" : "新建风格"}</div>
                        <p className="mt-1 text-sm text-muted-foreground">描述会在生成请求时附加，不会写入提示词输入框。</p>
                    </div>
                    <Button type="text" shape="circle" aria-label="返回风格库" icon={<X className="size-4" />} onClick={() => setEditing(null)} />
                </div>
                <div className="space-y-5">
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">风格名称</span>
                        <Input size="large" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：复古胶片、东方水墨" maxLength={80} showCount />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">风格描述</span>
                        <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述色彩、材质、光线、构图或影像质感……" autoSize={{ minRows: 5, maxRows: 9 }} maxLength={4000} showCount />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">适用范围</span>
                        <Select className="w-full" size="large" value={appliesTo} onChange={setAppliesTo} options={[{ value: "both", label: "图片和视频" }, { value: "image", label: "仅图片" }, { value: "video", label: "仅视频" }]} />
                    </label>
                </div>
                <div className="mt-7 flex justify-end gap-2 border-t border-border pt-4">
                    <Button onClick={() => setEditing(null)}>返回风格库</Button>
                    <Button type="primary" loading={isSaving} onClick={() => void submitEdit()}>保存风格</Button>
                </div>
            </div> : <div>
                <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-amber-500/[.09] via-transparent to-transparent px-5 pb-5 pt-6 sm:px-7">
                    <div className="relative flex items-start gap-3">
                        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-500/10 text-amber-600"><Sparkles className="size-5" /></div>
                        <div className="min-w-0 flex-1">
                            <div className="text-xl font-semibold tracking-tight">风格库</div>
                            <p className="mt-1 text-sm text-muted-foreground">选择一套视觉语言，为后续生成定下基调。</p>
                        </div>
                        {value ? <Button type="text" icon={<X className="size-3.5" />} onClick={() => { onChange(undefined); setOpen(false); }}>清除引用</Button> : null}
                    </div>
                    <Input className="mt-5" size="large" prefix={<Search className="size-4 text-muted-foreground" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索风格名称或描述" allowClear />
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>当前用于{type === "image" ? "图片" : "视频"}生成</span>
                        <span>{available.length} 套风格</span>
                    </div>
                </div>
                <div className={`thin-scrollbar max-h-[min(58vh,520px)] overflow-y-auto p-4 sm:p-6 ${className || ""}`}>
                    {isLoading ? <div className="grid h-36 place-items-center"><Spin /></div> : available.length ? <div className="grid gap-3 sm:grid-cols-2">
                        {available.map((style) => {
                            const active = style.id === value;
                            return <article key={style.id} className={`group relative flex min-h-40 flex-col rounded-2xl border p-4 transition-all ${active ? "border-amber-500/70 bg-amber-500/[.06] shadow-sm" : "border-border bg-card hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"}`}>
                                <button type="button" aria-label={`使用${style.name}`} className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" onClick={() => { onChange(active ? undefined : style); setOpen(false); }} />
                                <div className="relative flex items-start gap-2">
                                    <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${active ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"}`}>{active ? <Check className="size-4" /> : <Sparkles className="size-4" />}</div>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="truncate font-semibold">{style.name}</h3>
                                        <Tag className="mt-1 !mr-0 !rounded-full !px-2 !text-[10px]">{scopeLabel(style.appliesTo)}</Tag>
                                    </div>
                                    <div className="relative z-10 flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                        <Button type="text" size="small" aria-label={`编辑${style.name}`} icon={<Pencil className="size-3.5" />} onClick={() => beginEdit(style)} />
                                        <Popconfirm title="删除这个风格？" description="删除后无法恢复。" okText="删除" cancelText="取消" onConfirm={() => void deleteStyle(style)}>
                                            <Button danger type="text" size="small" aria-label={`删除${style.name}`} icon={<Trash2 className="size-3.5" />} />
                                        </Popconfirm>
                                    </div>
                                </div>
                                <p className="relative mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-muted-foreground">{style.prompt}</p>
                                <div className="relative mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-xs">
                                    <span className={active ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{active ? "正在使用" : "点击引用"}</span>
                                    {!active ? <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /> : null}
                                </div>
                            </article>;
                        })}
                    </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword ? "没有匹配的风格" : "还没有可用风格"} className="py-12">
                        {!keyword ? <span className="text-xs text-muted-foreground">创建一套自己的视觉语言，随时应用到生成中。</span> : null}
                    </Empty>}
                </div>
                <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                    <span className="text-xs text-muted-foreground">风格描述只会随生成请求发送</span>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => beginEdit()}>新建风格</Button>
                </div>
            </div>}
        </Modal>
    </>;
}
