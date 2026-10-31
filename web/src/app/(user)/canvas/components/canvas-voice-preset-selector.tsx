"use client";

import { useEffect, useState } from "react";
import { App, Button, Empty, Input, Modal, Popconfirm, Spin, Tag } from "antd";
import { Check, Plus, Trash2, UserRound, X } from "lucide-react";

import type { VoicePreset, VoicePresetRoleInput } from "@/services/api/voice-presets";
import { useUserStore } from "@/stores/use-user-store";
import { useVoicePresetStore } from "@/stores/use-voice-preset-store";

type CanvasVoicePresetSelectorProps = {
    value?: string;
    valueName?: string;
    onChange: (preset?: VoicePreset) => void;
};

export function CanvasVoicePresetSelector({ value, valueName, onChange }: CanvasVoicePresetSelectorProps) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const { presets, isLoading, load, save, remove } = useVoicePresetStore();
    const [open, setOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editing, setEditing] = useState<VoicePreset | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [roles, setRoles] = useState<VoicePresetRoleInput[]>([]);
    const [saving, setSaving] = useState(false);
    const selected = presets.find((preset) => preset.id === value);

    useEffect(() => {
        if (token) void load().catch((error) => message.error(error instanceof Error ? error.message : "获取语音预设失败"));
    }, [load, message, token]);

    const beginEdit = (preset?: VoicePreset) => {
        setEditOpen(true);
        setEditing(preset || null);
        setName(preset?.name || "");
        setDescription(preset?.description || "");
        setRoles(preset?.roles.map(({ id, alias, voiceDesign }) => ({ id, alias, voiceDesign })) || [{ alias: "", voiceDesign: "" }]);
    };

    const submit = async () => {
        if (!name.trim() || !roles.length || roles.some((role) => !role.alias.trim() || !role.voiceDesign.trim())) {
            message.warning("请填写作品名称，以及每个角色的代称和声音设计");
            return;
        }
        setSaving(true);
        try {
            const preset = await save({ ...(editing ? { id: editing.id } : {}), name, description, roles });
            onChange(preset);
            setEditing(null);
            setEditOpen(false);
            message.success("语音预设已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存语音预设失败");
        } finally {
            setSaving(false);
        }
    };

    const deletePreset = async (preset: VoicePreset) => {
        try {
            await remove(preset.id);
            if (preset.id === value) onChange(undefined);
            message.success("语音预设已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除语音预设失败");
        }
    };

    return <>
        <Button
            type="text"
            size="small"
            className={`!h-8 !w-8 !min-w-8 !px-0 ${value || selected ? "!text-rose-500" : ""}`}
            icon={<UserRound className="size-4" />}
            aria-label={selected || valueName ? `语音预设：${selected?.name || valueName}` : "选择语音预设"}
            title={selected || valueName ? `语音预设：${selected?.name || valueName}` : "选择语音预设"}
            onClick={() => token ? setOpen(true) : message.info("请先登录后使用语音预设")}
        />
        <Modal title={null} open={open} onCancel={() => { setOpen(false); setEditing(null); setEditOpen(false); }} footer={null} width="min(720px, calc(100vw - 24px))" centered destroyOnHidden styles={{ body: { padding: 0 } }}>
            {editOpen ? <div className="p-5 sm:p-7">
                <div className="mb-5 flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-600"><UserRound className="size-5" /></div>
                    <div className="min-w-0 flex-1"><div className="text-lg font-semibold">{editing ? "编辑语音预设" : "新建语音预设"}</div><p className="mt-1 text-sm text-muted-foreground">按作品保存角色代称和声音设计，仅应用于视频生成。</p></div>
                    <Button type="text" shape="circle" aria-label="返回语音预设列表" icon={<X className="size-4" />} onClick={() => { setEditing(null); setEditOpen(false); setName(""); }} />
                </div>
                <div className="space-y-4">
                    <Input size="large" value={name} onChange={(event) => setName(event.target.value)} placeholder="作品名称" maxLength={100} />
                    <Input.TextArea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="作品说明（可选）" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000} />
                    <div className="flex items-center justify-between"><span className="text-sm font-medium">角色声音设计</span><Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setRoles((current) => [...current, { alias: "", voiceDesign: "" }])}>添加角色</Button></div>
                    {roles.map((role, index) => <div key={role.id || index} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(120px,.7fr)_minmax(0,1.5fr)_auto] sm:items-start">
                        <Input value={role.alias} maxLength={80} placeholder="角色代称" onChange={(event) => setRoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, alias: event.target.value } : item))} />
                        <Input.TextArea value={role.voiceDesign} maxLength={2000} placeholder="声音设计，如音色、语速、年龄感、情绪特征" autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => setRoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, voiceDesign: event.target.value } : item))} />
                        <Button danger type="text" aria-label="删除角色" icon={<Trash2 className="size-4" />} onClick={() => setRoles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
                    </div>)}
                </div>
                <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4"><Button onClick={() => { setEditing(null); setEditOpen(false); setName(""); }}>返回</Button><Button type="primary" loading={saving} onClick={() => void submit()}>保存</Button></div>
            </div> : <div>
                <div className="border-b border-border bg-gradient-to-br from-rose-500/[.08] to-transparent px-5 py-5 sm:px-7">
                    <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-600"><UserRound className="size-5" /></div><div><div className="text-lg font-semibold">语音预设</div><p className="mt-1 text-sm text-muted-foreground">按作品复用角色声音设计</p></div>{value ? <Button className="ml-auto" type="text" onClick={() => { onChange(undefined); setOpen(false); }}>清除引用</Button> : null}</div>
                </div>
                <div className="thin-scrollbar max-h-[min(55vh,480px)] space-y-2 overflow-y-auto p-4 sm:p-6">
                    {isLoading ? <div className="grid h-28 place-items-center"><Spin /></div> : presets.length ? presets.map((preset) => <div key={preset.id} className={`flex items-center gap-3 rounded-xl border p-3 ${preset.id === value ? "border-rose-500/70 bg-rose-500/[.05]" : "border-border"}`}>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { onChange(preset.id === value ? undefined : preset); setOpen(false); }}><div className="flex items-center gap-2 font-medium">{preset.id === value ? <Check className="size-4 text-rose-600" /> : null}{preset.name}<Tag className="!mr-0">{preset.roles.length} 个角色</Tag></div><div className="mt-1 truncate text-xs text-muted-foreground">{preset.roles.map((role) => role.alias).join(" · ")}</div></button>
                        <Button type="text" size="small" onClick={() => beginEdit(preset)}>编辑</Button>
                        <Popconfirm title="删除该作品语音预设？" okText="删除" cancelText="取消" onConfirm={() => void deletePreset(preset)}><Button danger type="text" size="small" aria-label="删除语音预设" icon={<Trash2 className="size-4" />} /></Popconfirm>
                    </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有语音预设" />}
                </div>
                <div className="flex justify-end border-t border-border px-5 py-4 sm:px-7"><Button type="primary" icon={<Plus className="size-4" />} onClick={() => beginEdit()}>新建语音预设</Button></div>
            </div>}
        </Modal>
    </>;
}
