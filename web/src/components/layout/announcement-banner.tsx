"use client";

import { useEffect, useRef, useState } from "react";
import { Carousel, type GetRef } from "antd";
import { Megaphone, X } from "lucide-react";

const ANNOUNCEMENTS = [
    <><Megaphone className="mr-2 inline-block size-[18px] align-middle text-[var(--brand-accent)]" />TokenDance X 百亿 Token 补贴，一键登录即可接入，SD 2 Mini 低至 0.09元/秒 <a href="https://tokendance.space/" target="_blank" rel="noopener" className="whitespace-nowrap text-[var(--brand-accent)] underline-offset-4 hover:underline">查看详情</a></>,
    <><Megaphone className="mr-2 inline-block size-[18px] align-middle text-[var(--brand-accent)]" />无限画布现已支持 RunningHub X ComfyUI 工作流</>,
    <><Megaphone className="mr-2 inline-block size-[18px] align-middle text-[var(--brand-accent)]" />微信交流群现已开放 <a href="https://qr.tdeh.uk/ai" target="_blank" rel="noopener" className="whitespace-nowrap text-[var(--brand-accent)] underline-offset-4 hover:underline">扫码加入</a></>,
];
const DISMISSED_KEY = "infinite-canvas:announcement-dismissed";

export function AnnouncementBanner() {
    const [visible, setVisible] = useState(false);
    const [slide, setSlide] = useState({ index: 0, direction: "right" });
    const [paused, setPaused] = useState(false);
    const carouselRef = useRef<GetRef<typeof Carousel>>(null);

    useEffect(() => {
        try {
            setVisible(localStorage.getItem(DISMISSED_KEY) !== "1");
        } catch {
            setVisible(true);
        }
    }, []);

    if (!visible || !ANNOUNCEMENTS.length) return null;

    return (
        <section
            aria-label="站点公告"
            className="relative isolate min-h-9 w-full shrink-0 overflow-hidden border-b border-[var(--glass-border)] bg-[var(--glass-surface-subtle)] text-foreground/90 backdrop-blur-[var(--glass-blur)]"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
        >
            <Carousel
                ref={carouselRef}
                autoplay={ANNOUNCEMENTS.length > 1 && !paused}
                autoplaySpeed={5000}
                effect="fade"
                speed={0}
                beforeChange={(_, next) => setSlide((current) => current.index === next ? current : { index: next, direction: "right" })}
                adaptiveHeight
                dots={false}
                rootClassName="isolate"
            >
                {ANNOUNCEMENTS.map((content, index) => (
                    <div key={index}>
                        <div className={`flex min-h-9 items-center justify-center gap-2 px-10 py-1.5 text-center text-xs duration-300 in-[.slick-active]:animate-in in-[.slick-active]:fade-in sm:text-[13px] ${slide.direction === "left" ? "in-[.slick-active]:slide-in-from-left-2" : "in-[.slick-active]:slide-in-from-right-2"}`}>
                            <span className="min-w-0 break-words font-medium leading-5">{content}</span>
                        </div>
                    </div>
                ))}
            </Carousel>
            {ANNOUNCEMENTS.length > 1 && (
                <div aria-label="选择公告" className="group/indicators absolute bottom-px left-1/2 flex max-w-40 -translate-x-1/2">
                    {ANNOUNCEMENTS.map((_, index) => (
                        <button
                            key={index}
                            type="button"
                            aria-label={`显示第 ${index + 1} 条公告`}
                            aria-current={slide.index === index ? true : undefined}
                            className={`group/item flex h-2.5 shrink cursor-pointer items-end justify-center rounded-sm px-1 pb-0.5 transition-[width] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50 ${slide.index === index ? "w-9" : "w-5"}`}
                            onClick={() => {
                                if (index === slide.index) return;
                                setSlide({ index, direction: index < slide.index ? "left" : "right" });
                                carouselRef.current?.goTo(index);
                            }}
                        >
                            <span className={`h-0.5 w-full rounded-full transition-[height,background-color] duration-150 group-hover/indicators:h-1.5 ${slide.index === index ? "bg-[var(--brand-accent)]" : "bg-foreground/20 group-hover/item:bg-foreground/50"}`} />
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                aria-label="关闭公告"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-[var(--brand-accent-soft)] hover:text-[var(--brand-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50 sm:right-4"
                onClick={() => {
                    setVisible(false);
                    try {
                        localStorage.setItem(DISMISSED_KEY, "1");
                    } catch {}
                }}
            >
                <X className="size-4" />
            </button>
        </section>
    );
}
