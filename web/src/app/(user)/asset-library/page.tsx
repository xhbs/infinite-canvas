"use client";

import { Copy, FolderPlus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Card, Drawer, Empty, Image, Input, Pagination, Spin, Tag, Typography } from "antd";
import { useCopyText } from "@/hooks/use-copy-text";
import { getProxyUrl } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import styles from "@/components/assets/resource-glass.module.css";

const PAGE_SIZE = 12;

export default function AssetLibraryPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [keyword, setKeyword] = useState("");
    const [selectedType, setSelectedType] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [selectedAsset, setSelectedAsset] = useState<AssetLibraryItem | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);

    const query = useQuery({
        queryKey: ["asset-library", keyword, selectedType, selectedCategory, selectedTags, page],
        queryFn: () => fetchAssetLibrary({ keyword, type: selectedType, category: selectedCategory, tag: selectedTags, page, pageSize: PAGE_SIZE }),
        placeholderData: (previousData) => previousData,
        retry: false,
    });

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取素材库失败");
        }
    }, [message, query.error, query.isError]);

    const isReady = Boolean(query.data) || query.isError;
    const items = query.data?.items || [];
    const categories = query.data?.categories || [];
    const availableTags = query.data?.tags || [];
    const total = query.data?.total || 0;

    const toggleTag = (tag: string) => {
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const saveToMyAssets = async (asset: AssetLibraryItem) => {
        try {
            if (useAssetStore.getState().assets.some((item) => item.metadata?.source === "asset-library" && item.metadata.assetId === asset.id)) return void message.info("该素材已在我的素材中");
            if (asset.type === "image") {
                const blob = await (await fetch(getProxyUrl(asset.url))).blob();
                const bitmap = await createImageBitmap(blob);
                const { width, height } = bitmap;
                bitmap.close();
                if (useAssetStore.getState().assets.some((item) => item.metadata?.source === "asset-library" && item.metadata.assetId === asset.id)) return void message.info("该素材已在我的素材中");
                addAsset({
                    kind: "image",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    category: asset.category,
                    source: "素材库",
                    data: { dataUrl: asset.url, width, height, bytes: blob.size, mimeType: blob.type || "image/*" },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else if (asset.type === "video") {
                addAsset({
                    kind: "video",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    category: asset.category,
                    source: "素材库",
                    data: { url: asset.url, width: 0, height: 0, bytes: 0, mimeType: "video/mp4" },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else if (asset.type === "audio") {
                addAsset({
                    kind: "audio",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    category: asset.category,
                    source: "素材库",
                    data: { url: asset.url, mimeType: "audio/mpeg" },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            } else {
                addAsset({
                    kind: "text",
                    title: asset.title,
                    coverUrl: asset.coverUrl,
                    tags: asset.tags,
                    category: asset.category,
                    source: "素材库",
                    data: { content: asset.content },
                    metadata: { source: "asset-library", assetId: asset.id },
                });
            }
            message.success("已加入我的素材");
        } catch {
            message.error("加入失败");
        }
    };

    if (!isReady) {
        return (
            <div className={styles.page}>
                <div className="flex flex-1 items-center justify-center">
                    <Spin />
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <header className={styles.hero}>
                    <span className={styles.eyebrow}>团队共享</span>
                    <h1 className={styles.title}>素材库</h1>
                    <p className={styles.description}>挑选团队素材，加入我的素材后继续编辑和使用。</p>
                    <div className={styles.search}>
                        <Input
                            size="large"
                            className="w-full"
                            prefix={<Search className="size-4 text-muted-foreground" />}
                            value={keyword}
                            placeholder="搜索标题、内容、分类或标签"
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                        />
                    </div>
                </header>
                <section className={styles.filters} aria-label="素材库筛选">
                        <div className={styles.filterRow}>
                            <div className={styles.filterLabel}>类型</div>
                            <div className={styles.filterValues}>
                                {[
                                    { label: "全部", value: "" },
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                    { label: "音频", value: "audio" },
                                ].map((item) => (
                                    <Tag.CheckableTag
                                        key={item.value || "all"}
                                        checked={selectedType === item.value}
                                        className={cn(styles.filterTag, "prompt-filter-tag", selectedType === item.value && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            setSelectedType(item.value);
                                        }}
                                    >
                                        {item.label}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                        <div className={styles.filterRow}>
                            <div className={styles.filterLabel}>分类</div>
                            <div className={cn(styles.filterValues, "thin-scrollbar")}>
                                {["", ...categories].map((item) => (
                                    <Tag.CheckableTag
                                        key={item || "all"}
                                        checked={selectedCategory === item}
                                        className={cn(styles.filterTag, "prompt-filter-tag", selectedCategory === item && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            setSelectedCategory(item);
                                        }}
                                    >
                                        {item || "全部"}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                        <div className={styles.filterRow}>
                            <div className={styles.filterLabel}>标签</div>
                            <div className={cn(styles.filterValues, "thin-scrollbar")}>
                                <Tag.CheckableTag
                                    checked={selectedTags.length === 0}
                                    className={cn(styles.filterTag, "prompt-filter-tag", selectedTags.length === 0 && "is-active")}
                                    onChange={() => {
                                        setPage(1);
                                        setSelectedTags([]);
                                    }}
                                >
                                    全部
                                </Tag.CheckableTag>
                                {availableTags.map((tag) => (
                                    <Tag.CheckableTag
                                        key={tag}
                                        checked={selectedTags.includes(tag)}
                                        className={cn(styles.filterTag, "prompt-filter-tag", selectedTags.includes(tag) && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            toggleTag(tag);
                                        }}
                                    >
                                        {tag}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                        </div>
                </section>

                <div className={styles.grid}>
                    {items.map((asset) => (
                        <LibraryCard key={asset.id} asset={asset} onOpen={() => setSelectedAsset(asset)} onAdd={() => void saveToMyAssets(asset)} />
                    ))}
                </div>

                {!items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到素材" className={cn(styles.empty, "py-20")} /> : null}

                <div className={styles.pager}>
                    <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={(nextPage) => setPage(nextPage)} />
                </div>
            </main>

            <Drawer rootClassName={styles.glassDrawer} title="素材详情" open={Boolean(selectedAsset)} size="large" onClose={() => setSelectedAsset(null)}>
                {selectedAsset ? (
                    <div className="space-y-5">
                        {selectedAsset.coverUrl ? (
                            <Image src={selectedAsset.coverUrl} alt={selectedAsset.title} className={styles.drawerImage} />
                        ) : (
                            <div className={styles.contentPanel}>{selectedAsset.content || "暂无封面"}</div>
                        )}
                        <div>
                            <Typography.Title level={4} className="!mb-2">
                                {selectedAsset.title}
                            </Typography.Title>
                            <div className="flex flex-wrap gap-1.5">
                                <Tag>{assetTypeLabel(selectedAsset.type)}</Tag>
                                {selectedAsset.tags.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                        </div>
                        <div className={styles.contentPanel}>
                            <Typography.Text type="secondary" className="block text-xs">
                                内容
                            </Typography.Text>
                            {selectedAsset.type === "text" ? <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{selectedAsset.content}</Typography.Paragraph> : <Typography.Text className="mt-2 block">{selectedAsset.url}</Typography.Text>}
                        </div>
                        {selectedAsset.description ? <Typography.Paragraph type="secondary">{selectedAsset.description}</Typography.Paragraph> : null}
                        <div className="flex flex-wrap gap-2">
                            {selectedAsset.type === "text" ? (
                                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(selectedAsset.content)}>
                                    复制文本
                                </Button>
                            ) : null}
                            {selectedAsset.type !== "text" ? (
                                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(selectedAsset.url)}>
                                    复制链接
                                </Button>
                            ) : null}
                            <Button icon={<FolderPlus className="size-4" />} onClick={() => void saveToMyAssets(selectedAsset)}>
                                加入我的素材
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function LibraryCard({ asset, onOpen, onAdd }: { asset: AssetLibraryItem; onOpen: () => void; onAdd: () => void }) {
    const cover = asset.coverUrl;
    return (
        <Card
            hoverable
            className={styles.card}
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className={styles.mediaButton} onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className={styles.thumbnail} />
                    ) : (
                        <div className={styles.placeholder}>{asset.content || "暂无封面"}</div>
                    )}
                </button>
            }
        >
            <button type="button" className={styles.cardOpen} onClick={onOpen}>
                <div className={styles.cardContent}>
                    <div className={styles.cardHeading}>
                        <h2 className={styles.cardTitle}>{asset.title}</h2>
                        <Tag className="m-0 shrink-0 text-[11px]">{assetTypeLabel(asset.type)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {asset.type === "text" ? asset.content : asset.url}
                    </Typography.Paragraph>
                    <div className={styles.cardTags}>
                        {asset.tags.slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags.length ? <Tag className="m-0 text-[11px]">无标签</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    查看
                </Button>
                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={onAdd}>
                    加入我的素材
                </Button>
            </div>
        </Card>
    );
}

function assetTypeLabel(type: AssetLibraryItem["type"]) {
    if (type === "image") return "图片";
    if (type === "video") return "视频";
    if (type === "audio") return "音频";
    return "文本";
}
