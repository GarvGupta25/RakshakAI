import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  githubAppId: process.env.GITHUB_APP_ID,
  githubPrivateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  groqApiKey: process.env.GROQ_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL
};
