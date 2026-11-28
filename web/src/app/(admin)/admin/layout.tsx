"use client";

import { AuditOutlined, FileTextOutlined, HomeOutlined, LogoutOutlined, PictureOutlined, SettingOutlined, ToolOutlined, TransactionOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Typography, theme } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { adminLayoutStyle } from "@/lib/app-theme";
import { useUserStore } from "@/stores/use-user-store";

import styles from "./admin-glass.module.css";

const adminMenus = [
    { key: "/admin/users", icon: <UserOutlined />, label: "用户管理" },
    { key: "/admin/credit-logs", icon: <TransactionOutlined />, label: "算力点日志" },
    { key: "/admin/ai-logs", icon: <AuditOutlined />, label: "AI 日志" },
    { key: "/admin/prompts", icon: <FileTextOutlined />, label: "提示词管理" },
    { key: "/admin/skills", icon: <ToolOutlined />, label: "Skill 管理" },
    { key: "/admin/assets", icon: <PictureOutlined />, label: "素材库" },
    { key: "/admin/settings", icon: <SettingOutlined />, label: "系统设置" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { token: antToken } = theme.useToken();
    const router = useRouter();
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const logout = useUserStore((state) => state.clearSession);
    const activeKey = pathname.startsWith("/admin/settings")
        ? "/admin/settings"
        : pathname.startsWith("/admin/assets")
          ? "/admin/assets"
          : pathname.startsWith("/admin/skills")
            ? "/admin/skills"
            : pathname.startsWith("/admin/prompts")
              ? "/admin/prompts"
              : pathname.startsWith("/admin/ai-logs")
                ? "/admin/ai-logs"
                : pathname.startsWith("/admin/credit-logs")
                  ? "/admin/credit-logs"
                  : pathname.startsWith("/admin/users")
                    ? "/admin/users"
                    : "";
    const pageTitle = pathname.startsWith("/admin/settings") ? "系统设置" : pathname.startsWith("/admin/assets") ? "素材库管理" : pathname.startsWith("/admin/skills") ? "Skill 管理" : pathname.startsWith("/admin/prompts") ? "提示词管理" : pathname.startsWith("/admin/ai-logs") ? "AI 日志" : pathname.startsWith("/admin/credit-logs") ? "算力点日志" : "用户管理";

    useEffect(() => {
        if (!isReady) return;
        if (!token) {
            router.replace("/login?redirect=/admin");
            return;
        }
        if (user?.role !== "admin") {
            router.replace("/");
        }
    }, [isReady, router, token, user?.role]);

    if (!isReady || !token || user?.role !== "admin") {
        return (
            <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
                <span />
            </div>
        );
    }

    return (
        <Layout hasSider className={styles.shell} style={{ height: "100dvh", overflow: "hidden", background: antToken.colorBgLayout }}>
            <Layout.Sider width={adminLayoutStyle.siderWidth} className={styles.sider} style={{ height: "100dvh", overflow: "hidden" }}>
                <Flex align="center" gap={12} className={styles.brandRow} style={{ height: adminLayoutStyle.brandHeight, padding: "0 20px" }}>
                    <span aria-hidden className={styles.brandMark} style={{ display: "inline-block", width: 30, height: 30, WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
                    <Typography.Text strong className={styles.brandText} style={{ fontSize: 18, letterSpacing: 0 }}>
                        无限画布
                    </Typography.Text>
                </Flex>
                <Menu
                    mode="inline"
                    selectedKeys={[activeKey]}
                    className={styles.menu}
                    style={adminLayoutStyle.menu}
                    items={adminMenus.map((item) => ({
                        ...item,
                        label: (
                            <Link href={item.key} aria-label={item.label} title={item.label} style={{ color: "inherit" }}>
                                {item.label}
                            </Link>
                        ),
                        style: adminLayoutStyle.menuItem,
                    }))}
                />
                <Flex vertical gap={8} className={styles.siderActions} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12 }}>
                    <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer" title="前往画布" aria-label="前往画布">
                        前往画布
                    </Button>
                    <Button block icon={<LogoutOutlined />} onClick={logout} title="退出登录" aria-label="退出登录">
                        退出登录
                    </Button>
                </Flex>
            </Layout.Sider>
            <Layout style={{ background: "transparent", minWidth: 0 }}>
                <Layout.Header
                    className={styles.header}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: adminLayoutStyle.headerHeight, padding: "0 24px" }}
                >
                    <Typography.Title level={5} style={{ margin: 0 }}>
                        {pageTitle}
                    </Typography.Title>
                    <Flex align="center" gap={4}>
                        <UserStatusActions showConfig={false} />
                    </Flex>
                </Layout.Header>
                <Layout.Content className={styles.content} style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
            </Layout>
        </Layout>
    );
}
