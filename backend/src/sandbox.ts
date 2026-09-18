import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs a scanner with no host checkout or source-code execution. */
export async function scanDiffInSandbox(diff: string): Promise<{ secretsFound: boolean; output: string }> {
  const encoded = Buffer.from(diff).toString("base64");
  const command = `printf %s '${encoded}' | base64 -d > /work/change.patch && gitleaks detect --no-git --source /work --report-format json --report-path /work/report.json; code=$?; cat /work/report.json 2>/dev/null || true; exit $code`;
  try {
    const { stdout, stderr } = await execFileAsync("docker", ["run", "--rm", "--network", "none", "agentguard-sandbox", command], { timeout: 120_000 });
    return { secretsFound: false, output: stdout || stderr };
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; code?: number };
    if (details.code === 1) return { secretsFound: true, output: details.stdout ?? details.stderr ?? "secret detected" };
    throw new Error(`Sandbox scan failed: ${details.stderr ?? String(error)}`);
  }
}
