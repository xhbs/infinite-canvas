"use client";

import { Copy } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button, Card, Tag } from "antd";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import styles from "./prompt-glass.module.css";

export function PromptCard({
    item,
    index = 0,
    onOpen,
    onCopy,
    actionLabel = "复制",
    actionIcon = <Copy className="size-3.5" />,
    actionType = "text",
    extraAction,
}: {
    item: Prompt;
    index?: number;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
}) {
    return (
        <Card
            hoverable
            className={styles.card}
            style={{ "--fx-index": Math.min(index, 11) } as CSSProperties}
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className={styles.cardOpen} onClick={onOpen}>
                    <img src={item.coverUrl} alt={item.title} className={styles.thumbnail} />
                </button>
            }
        >
            <button type="button" className={styles.cardOpen} onClick={onOpen}>
                <div className={styles.cardContent}>
                    <div className={styles.cardHeading}>
                        <h2 className={styles.cardTitle}>{item.title}</h2>
                        <span className={styles.date}>{formatPromptDate(item.updatedAt)}</span>
                    </div>
                    <p className={styles.excerpt}>{item.prompt}</p>
                    <div className={styles.tagList}>
                        {item.tags.map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            </button>
            <div className={styles.cardActions}>
                <Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>
                    {actionLabel}
                </Button>
                {extraAction}
            </div>
        </Card>
    );
}
