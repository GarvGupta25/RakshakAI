import { Worker } from "bullmq";
import { classifyDiff } from "./classification.js";
import { getChangedSources, getCommitDiff } from "./github.js";
import { RepoLock } from "./lock.js";
import { connection, type PushJob } from "./queue.js";
import { scanDiffInSandbox } from "./sandbox.js";
import { RepoStateStore, addTokenUsage, appendVerdict, deriveHealthScore, filesFromDiff, type AnalysisTier, type RiskLevel, type Verdict, type VerdictRecord } from "./state.js";
import { callCheapModel, callReasoningModel } from "./llm.js";
import { config } from "./config.js";
import { setCommitCheck, postCommitComment } from "./github.js";
import { DiscordNotifier, type SecurityNotification } from "./notifications.js";
import { IncidentStore, type Incident } from "./incidents.js";
import { applySafeCorrection } from "./corrections.js";
import { remediateBlockedChange } from "./remediation.js";
import { rotateCompromisedKeyOIDC } from "./oidc.js";
import { incidentExplainUrl } from "./urls.js";
import { DependencyGraph, renderMermaid } from "./graph.js";

const locks = new RepoLock(connection);
const state = new RepoStateStore(connection);
const notifier = new DiscordNotifier();
const incidents = new IncidentStore(connection);

async function saveAndNotify(incident: Incident, notification: SecurityNotification) {
  await incidents.save(incident);
  try {
    const status = await notifier.sendNotification(notification);
    await incidents.recordNotification(incident.job.repoId, incident.job.sha, { channel: "discord", status, attemptedAt: new Date().toISOString() });
  } catch (error) {
    await incidents.recordNotification(incident.job.repoId, incident.job.sha, { channel: "discord", status: "failed", attemptedAt: new Date().toISOString(), error: String(error) });
    console.error("Incident notification failed", error);
  }
}

export const worker = new Worker<PushJob>("push-analysis", async job => {
  const startedAt = Date.now();
  const release = await locks.acquire(job.data.repoId);
  try {
    const diff = await getCommitDiff(job.data);
    const priorState = await state.getRepoState(job.data.repoId);
    const changedFiles = filesFromDiff(diff);
    await new DependencyGraph(connection, job.data.repoId).updateFiles(await getChangedSources(job.data, changedFiles));
    const knownFiles = [...new Set([...priorState.known_file_list, ...changedFiles])].slice(-5_000);
    const record = (risk_level: RiskLevel, verdict: Verdict, tier: AnalysisTier, summary: string, details: Partial<VerdictRecord> = {}): VerdictRecord => ({ commit_sha: job.data.sha, risk_level, verdict, timestamp: new Date().toISOString(), tier, latency_ms: Date.now() - startedAt, files: changedFiles, summary, ...details });
    const scan = await scanDiffInSandbox(diff);
    if (scan.secretsFound) {
      const recent_verdicts = appendVerdict(priorState.recent_verdicts, record("dangerous", "block", "static", "Potential credential detected in the actual patch."));
      const rotation = await rotateCompromisedKeyOIDC("credential-pattern-detected", "aws").catch(error => ({ status: "skipped" as const, provider: "aws" as const, reason: String(error) }));
      await state.updateRepoState(job.data.repoId, { known_file_list: knownFiles, recent_verdicts, health_score: deriveHealthScore(recent_verdicts) });
      const incident = { id: `${job.data.repoId}:${job.data.sha}`, job: job.data, diff, createdAt: new Date().toISOString(), reason: "Potential credential detected in the actual patch.", verdict: { verdict: "block" as const, human_summary: "Potential credential detected in the actual patch.", technical_summary: `${scan.output}\nRotation: ${rotation.status} — ${rotation.reason}`, tokens_used: 0 } };
      await setCommitCheck(job.data, "failure", "Potential credential detected. The change requires human review.");
      await saveAndNotify(incident, { repo: `${job.data.owner}/${job.data.repo}`, sha: job.data.sha, summary: incident.reason, explainUrl: incidentExplainUrl(config.publicUrl, job.data.repoId, job.data.sha) });
      return { route: "remediate", reason: "secret_detected", remediation: await remediateBlockedChange(job.data, priorState.last_scanned_commit_sha) };
    }
    const classification = classifyDiff(diff);
    if (classification === "style_only") {
      const correction = await applySafeCorrection(job.data);
      const recent_verdicts = appendVerdict(priorState.recent_verdicts, record("safe", "allow", "static", correction.reason));
      await state.updateRepoState(job.data.repoId, { last_scanned_commit_sha: job.data.sha, known_file_list: knownFiles, recent_verdicts, health_score: deriveHealthScore(recent_verdicts), auto_corrections_applied: priorState.auto_corrections_applied + Number(correction.applied) });
      await setCommitCheck(job.data, "success", correction.reason);
      return { route: "auto_correct", classification, correction };
    }
    const context = await state.getRelevantContext(job.data.repoId, diff);
    const cheap = await callCheapModel(diff, context);
    if (cheap.risk_level === "safe") {
      const recent_verdicts = appendVerdict(priorState.recent_verdicts, record("safe", "allow", "cheap", cheap.reason, { cheap_verdict: cheap }));
      await state.updateRepoState(job.data.repoId, { last_scanned_commit_sha: job.data.sha, known_file_list: knownFiles, recent_verdicts, health_score: deriveHealthScore(recent_verdicts), ...addTokenUsage(priorState, cheap.tokens_used) });
      await setCommitCheck(job.data, "success", cheap.reason);
      return { route: "allow", classification, cheap };
    }
    const final = await callReasoningModel(diff, context);
    const recent_verdicts = appendVerdict(priorState.recent_verdicts, record(cheap.risk_level, final.verdict, "reasoning", final.human_summary, { cheap_verdict: cheap, final_verdict: final }));
    await state.updateRepoState(job.data.repoId, {
      ...(final.verdict !== "block" ? { last_scanned_commit_sha: job.data.sha } : {}),
      known_file_list: knownFiles, recent_verdicts, health_score: deriveHealthScore(recent_verdicts), ...addTokenUsage(priorState, cheap.tokens_used + final.tokens_used)
    });
    if (final.verdict === "block") {
      const incident = { id: `${job.data.repoId}:${job.data.sha}`, job: job.data, diff, createdAt: new Date().toISOString(), reason: final.human_summary, verdict: final };
      await setCommitCheck(job.data, "failure", final.human_summary);
      const explainUrl = incidentExplainUrl(config.publicUrl, job.data.repoId, job.data.sha);
      await saveAndNotify(incident, { repo: `${job.data.owner}/${job.data.repo}`, sha: job.data.sha, summary: final.human_summary, explainUrl });
      
      const diagram = context.dirty_subgraph ? renderMermaid(context.dirty_subgraph) : `graph TD\n  Commit["Commit ${job.data.sha.slice(0, 7)}"] --> Blocked((Blocked))`;
      const commentBody = `🚨 **AgentGuard blocked this change.**\n\n${final.human_summary}\n\n<details><summary>Technical Summary</summary>\n\n${final.technical_summary}\n</details>\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n[View detailed explanation](${explainUrl})`;
      await postCommitComment(job.data, commentBody).catch(e => console.error("Failed to post comment", e));
    } else await setCommitCheck(job.data, "success", final.human_summary);
    return { route: final.verdict === "block" ? "remediate" : "allow", cheap, final, ...(final.verdict === "block" ? { remediation: await remediateBlockedChange(job.data, priorState.last_scanned_commit_sha) } : {}) };
  } finally { await release(); }
}, { connection });

worker.on("failed", (job, error) => console.error("Analysis job failed", job?.id, error));
