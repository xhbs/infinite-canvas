"use client";

import { CreativeWorkflowWorkspace } from "@/components/workflows/creative-workflow-workspace";
import styles from "./workflows.module.css";

export default function WorkflowsPage() {
    return <div className={styles.page}><CreativeWorkflowWorkspace /></div>;
}
