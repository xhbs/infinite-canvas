"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function AppTopNav() {
    const pathname = usePathname();
    const reducedMotion = useReducedMotion();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    return (
        <>
            {!hideHeader && <AnnouncementBanner />}
            {!hideHeader ? (
                <header
                    className="sticky top-0 z-20 h-15 shrink-0 border-b border-[var(--glass-border)] bg-[var(--glass-surface)] backdrop-blur-[var(--glass-blur-strong)] before:pointer-events-none before:absolute before:inset-x-16 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-[var(--brand-accent)]/20 before:to-transparent"
                    style={{ boxShadow: "var(--glass-shadow-soft), inset 0 1px 0 var(--glass-highlight)" }}
                >
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link href="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-foreground transition hover:text-[var(--brand-accent)]">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="text-base font-medium">无限画布</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-[var(--brand-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]/50 md:hidden"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-7 hidden h-15 min-w-0 items-center gap-2 overflow-x-auto md:flex">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            href={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm transition-colors",
                                                active
                                                    ? "font-medium text-[var(--brand-accent)]"
                                                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                                            )}
                                        >
                                            {active ? (
                                                <motion.span
                                                    layoutId={reducedMotion ? undefined : "top-nav-active-pill"}
                                                    transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
                                                    aria-hidden="true"
                                                    className="absolute inset-0 -z-10 rounded-full border border-[var(--brand-accent)]/25 bg-[var(--brand-accent-soft)] shadow-[inset_0_1px_0_var(--glass-highlight),0_4px_14px_color-mix(in_srgb,var(--brand-accent)_12%,transparent)]"
                                                />
                                            ) : null}
                                            <Icon className="relative z-10 size-4" />
                                            <span className="relative z-10 truncate">{tool.label}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
