import { readFile } from "node:fs/promises";
import { config } from "./config.js";

export type RotationResult = { status: "rotated" | "skipped"; provider: "aws" | "gcp" | "azure"; reason: string };

export async function rotateCompromisedKeyOIDC(evidence: string, provider: RotationResult["provider"] = "aws"): Promise<RotationResult> {
  if (!config.rotationEndpoint || !config.oidcTokenFile) return { status: "skipped", provider, reason: "OIDC rotation is not configured" };
  const endpoint = new URL(config.rotationEndpoint);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") throw new Error("Credential rotation endpoint must use HTTPS");
  const token = (await readFile(config.oidcTokenFile, "utf8")).trim();
  if (!token) throw new Error("OIDC token file is empty");
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ provider, evidence }) });
  if (!response.ok) throw new Error(`Credential rotation failed (${response.status})`);
  return { status: "rotated", provider, reason: "OIDC rotation endpoint accepted the remediation request" };
}
