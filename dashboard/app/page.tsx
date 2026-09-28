import Dashboard, { type DashboardState } from "./dashboard";

async function loadRepoState(): Promise<DashboardState | null> {
  const repoId = process.env.NEXT_PUBLIC_DEFAULT_REPO_ID;
  if (!repoId) return null;

  try {
    const api = process.env.AGENTGUARD_API_URL ?? "http://localhost:3000";
    const response = await fetch(`${api}/api/repositories/${encodeURIComponent(repoId)}`, { cache: "no-store" });
    return response.ok ? await response.json() as DashboardState : null;
  } catch {
    return null;
  }
}

export default async function Page() {
  const api = process.env.NEXT_PUBLIC_AGENTGUARD_API_URL ?? process.env.AGENTGUARD_API_URL ?? "http://localhost:3000";
  return <Dashboard initialState={await loadRepoState()} installUrl={`${api}/install`} />;
}
