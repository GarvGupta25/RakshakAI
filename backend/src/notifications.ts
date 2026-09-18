import { config } from "./config.js";

export interface SecurityNotification { repo: string; sha: string; summary: string; explainUrl: string; }
export interface Notifier { sendNotification(event: SecurityNotification): Promise<void>; }

export class DiscordNotifier implements Notifier {
  async sendNotification(event: SecurityNotification) {
    if (!config.discordWebhookUrl) return;
    const response = await fetch(config.discordWebhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `🚨 **AgentGuard blocked a change**\n${event.repo}@${event.sha.slice(0, 8)}: ${event.summary}\nExplain: ${event.explainUrl}` }) });
    if (!response.ok) throw new Error(`Discord notification failed (${response.status})`);
  }
}
