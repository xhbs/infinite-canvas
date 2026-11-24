"use client";

import { useEffect, useState } from "react";
import { Button, Pagination, Spin, theme as antdTheme } from "antd";
import { RefreshCw } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { fetchNodeAICallLogs, type AICallLog } from "@/services/api/ai-logs";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const stageLabels: Record<string, string> = { upload: "上传素材", create: "提交生成", poll: "查询进度", response: "生成返回", result: "生成结果", download: "下载结果" };

export function CanvasNodeLogs({ nodeId, running }: { nodeId: string; running: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const token = useUserStore((state) => state.token);
    const { token: colors } = antdTheme.useToken();
    const [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0);
    const [logs, setLogs] = useState<AICallLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        setLogs([]);
        setError("");
        const load = async () => {
            setLoading(true);
            try {
                const result = await fetchNodeAICallLogs(nodeId, page, 20, controller.signal);
                if (controller.signal.aborted) return;
                setLogs(result.items);
                setTotal(result.total);
                setError("");
                if (page > 1 && result.total <= (page - 1) * 20) setPage(1);
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取节点日志失败");
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    if (running) timer = setTimeout(() => void load(), 5000);
                }
            }
        };
        void load();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [nodeId, token, page, running, revision]);

    const groups = new Map<string, AICallLog[]>();
    for (const log of logs) {
        const key = log.taskId || "";
        const group = groups.get(key) || [];
        group.push(log);
        groups.set(key, group);
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-3" style={{ color: theme.node.text }}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs" style={{ color: theme.node.placeholder }}>服务器日志 · 共 {total} 条{running ? " · 每 5 秒刷新" : ""}</span>
                <Button type="text" size="small" loading={loading} icon={<RefreshCw className="size-3.5" />} onClick={() => setRevision((value) => value + 1)}>刷新</Button>
            </div>
            {error ? <div role="alert" className="text-xs" style={{ color: colors.colorError }}>{error}</div> : null}
            <div className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-auto pr-1">
                {!logs.length ? (
                    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 text-center text-xs" style={{ color: theme.node.placeholder }}>
                        {loading ? <Spin size="small" /> : <><span>{error ? "日志暂时无法读取，可点击刷新重试" : "暂无请求日志"}</span><span>新请求会记录在这里；每次轮询单独保留。</span></>}
                    </div>
                ) : Array.from(groups, ([taskId, items]) => (
                    <section key={taskId} className="space-y-2">
                        <div className="space-y-1 text-xs" style={{ color: theme.node.placeholder }}>
                            <div>{taskId ? "生成任务" : "其他请求"}</div>
                            {taskId ? <div className="break-all font-mono text-[11px]">{taskId}</div> : null}
                        </div>
                        {items.map((log) => (
                            <details key={log.id} className="group rounded-lg border" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                <summary className="cursor-pointer space-y-1.5 px-3 py-2.5 text-xs">
                                    <span className="ml-1 font-medium">{stageLabels[log.stage || ""] || (log.method === "GET" ? "查询进度" : "生成请求")}</span>
                                    <span className="float-right" style={{ color: log.failed || log.error || log.status >= 400 || !log.status ? colors.colorError : theme.node.placeholder }}>{log.status ? `HTTP ${log.status}` : "请求异常"} · {formatDuration(log.durationMs)}</span>
                                    <div className="flex justify-between gap-2 pl-4 text-[11px]" style={{ color: theme.node.placeholder }}><span>{formatTime(log.startedAt || log.createdAt)}</span><span className="truncate">{log.model || log.channelName}</span></div>
                                </summary>
                                <div className="space-y-3 border-t px-3 py-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                                    <div className="break-all font-mono text-[11px]">{log.method} {log.endpoint}</div>
                                    <div style={{ color: theme.node.placeholder }}>结束：{formatTime(log.completedAt || log.failedAt)}{log.channelName ? ` · ${log.channelName}` : ""}</div>
                                    {log.error ? <p className="whitespace-pre-wrap break-words" style={{ color: colors.colorError }}>{log.error}</p> : null}
                                    {[{ label: "请求参数", body: log.requestBody }, { label: "返回内容", body: log.responseBody }].map(({ label, body }) => (
                                        <div key={label} className="space-y-1.5">
                                            <div style={{ color: theme.node.placeholder }}>{label}</div>
                                            <pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md p-2 font-mono text-[11px] leading-5" style={{ background: theme.toolbar.itemHover }}>{body || "（无内容）"}</pre>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ))}
                    </section>
                ))}
            </div>
            {total > 20 ? <Pagination size="small" current={page} total={total} pageSize={20} showSizeChanger={false} onChange={setPage} /> : null}
        </div>
    );
}

function formatTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value: number) {
    return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} 秒`;
}
