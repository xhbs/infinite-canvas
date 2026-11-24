"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Tooltip, Typography } from "antd";
import { KeyRound, Link2, PlugZap, Radio } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { useCodexAgent } from "../agent/use-codex-agent";

type Agent = Pick<ReturnType<typeof useCodexAgent>, "connection" | "status" | "error" | "connect" | "disconnect" | "models">;

const STATUS_META = {
    idle: { label: "未连接", dot: "#a8a29e" },
    connecting: { label: "连接中", dot: "#f59e0b" },
    ready: { label: "已连接", dot: "#22c55e" },
    error: { label: "连接失败", dot: "#ef4444" },
} as const;

/**
 * 顶栏常驻的桥状态入口：不打开 Agent 面板也能看到连接状态并配置。
 * 点一下出弹窗，里面能改地址 / Token，也可直接连或断开。
 */
export function CanvasBridgeStatus({ agent }: { agent: Agent }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(agent.connection);
    const [busy, setBusy] = useState(false);
    const meta = STATUS_META[agent.status];
    const connected = agent.status === "ready";

    useEffect(() => setDraft(agent.connection), [agent.connection.endpoint, agent.connection.token]);
    // 连上之后自动收起弹窗，避免挡住画布。
    useEffect(() => {
        if (connected) setOpen(false);
    }, [connected]);

    const submit = async () => {
        setBusy(true);
        try {
            if (connected) agent.disconnect();
            else await agent.connect(draft);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Tooltip title={`画布桥：${meta.label}${connected ? `（已注册 ${agent.models.length ? "可用" : "等待"}工具）` : "，点此配置"}`}>
                <Button
                    type="text"
                    className="!h-10 !rounded-xl !px-3 !font-medium"
                    style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                    icon={<Radio className="size-4" style={{ color: meta.dot }} />}
                    onClick={() => setOpen(true)}
                    aria-label={`画布桥状态：${meta.label}`}
                >
                    <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: meta.dot }} />
                        {meta.label}
                    </span>
                </Button>
            </Tooltip>
            <Modal
                title="画布桥连接"
                open={open}
                onCancel={() => setOpen(false)}
                centered
                footer={[
                    <Button key="close" onClick={() => setOpen(false)}>关闭</Button>,
                    <Button key="submit" type={connected ? "default" : "primary"} loading={busy} icon={<PlugZap className="size-4" />} onClick={() => void submit()}>
                        {connected ? "断开" : "连接"}
                    </Button>,
                ]}
            >
                <div className="space-y-3 pt-1">
                    <p className="text-xs leading-5 opacity-65">
                        画布打开时会自动连接本机桥。也可在这里手动填写桥地址和 Token。
                    </p>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="size-2 rounded-full" style={{ background: meta.dot }} />
                        <span>{meta.label}</span>
                        {connected && agent.models.length ? <span className="text-xs opacity-55">已注册 {agent.models.length} 个工具</span> : null}
                    </div>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs opacity-65"><Link2 className="size-3.5" />桥地址</span>
                        <Input aria-label="桥地址" value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} placeholder="http://127.0.0.1:3211" />
                    </label>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs opacity-65"><KeyRound className="size-3.5" />Token</span>
                        <Input.Password aria-label="Token" value={draft.token} onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} placeholder="本机桥 Token" />
                    </label>
                    {agent.error ? <Typography.Text type="danger" className="!text-xs leading-5">{agent.error}</Typography.Text> : null}
                </div>
            </Modal>
        </>
    );
}
