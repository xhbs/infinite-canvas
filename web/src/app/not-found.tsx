import { Home, LogIn } from "lucide-react";
import Link from "next/link";

import styles from "./not-found.module.css";

export default function NotFound() {
    return (
        <div className={`${styles.page} fx-ambient-stage`}>
            <main className={styles.main}>
                <section className={`${styles.card} fx-rise-in`}>
                    <div className={styles.code}>404</div>
                    <h1 className={styles.title}>页面不存在</h1>
                    <p className={styles.description}>这个地址没有对应的页面，可能已经移动或被合并到其他入口。</p>
                    <div className={styles.actions}>
                        <Link href="/" className={`${styles.primaryAction} fx-btn-glint`}>
                            <Home className="size-4" />
                            返回首页
                        </Link>
                        <Link href="/login" className={styles.secondaryAction}>
                            <LogIn className="size-4" />
                            去登录
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
