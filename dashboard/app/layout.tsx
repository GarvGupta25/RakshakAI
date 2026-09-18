import "./styles.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "AgentGuard", description: "Repository orchestration dashboard" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
