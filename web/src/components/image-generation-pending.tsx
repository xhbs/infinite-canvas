"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { formatDuration } from "@/lib/image-utils";
import { cn } from "@/lib/utils";

const pendingMessages = ["正在创建图片", "马上就好了", "再等等", "正在整理细节"];

export function ImageGenerationPending({ className, label, compact = false }: { className?: string; label?: string; compact?: boolean }) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const index = Math.floor(tick / 2) % pendingMessages.length;
    const progress = Math.min(98, 10 + (1 - Math.exp(-tick / 28)) * 88);

    return (
        <div className={cn("fx-pulse-ring relative overflow-hidden border border-[color-mix(in_srgb,var(--brand-accent)_28%,var(--glass-border))] bg-[var(--glass-surface-subtle)] backdrop-blur-md", compact ? "min-h-24" : "aspect-[4/3]", className)}>
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-2/3"
                style={{
                    background: "linear-gradient(105deg, transparent 20%, color-mix(in srgb, var(--brand-accent) 14%, transparent) 48%, color-mix(in srgb, var(--glass-glint) 20%, transparent) 54%, transparent 80%)",
                    animation: "fx-shimmer-sweep 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite",
                }}
            />
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--brand-accent) 32%, transparent) 1.3px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                    maskImage: "radial-gradient(ellipse at 38% 68%, black 0%, black 28%, transparent 60%)",
                }}
            />
            <div className="absolute left-4 top-4 flex items-center gap-2 text-[14px] font-medium text-foreground/85">
                <LoaderCircle className="size-4 animate-spin text-[var(--brand-accent)]" />
                <span>{label || pendingMessages[index]}</span>
            </div>
            <div className="absolute bottom-4 left-4 right-4">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatDuration(tick * 1000)}</span>
                    <span className="tabular-nums text-[var(--brand-accent)]">{Math.floor(progress)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                        style={{
                            width: `${progress}%`,
                            background: "linear-gradient(90deg, var(--brand-accent), var(--glass-glint))",
                            boxShadow: "0 0 10px color-mix(in srgb, var(--brand-accent) 45%, transparent)",
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
