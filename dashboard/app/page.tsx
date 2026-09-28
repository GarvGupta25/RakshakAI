import Dashboard, { type DashboardIncident, type DashboardState } from "./dashboard";

const apiUrl = () => process.env.AGENTGUARD_API_URL ?? "http://localhost:3000";

async function loadRepoState(): Promise<DashboardState | null> {
  const repoId = process.env.NEXT_PUBLIC_DEFAULT_REPO_ID;
  if (!repoId) return null;

  try {
    const response = await fetch(`${apiUrl()}/api/repositories/${encodeURIComponent(repoId)}`, { cache: "no-store" });
    return response.ok ? await response.json() as DashboardState : null;
  } catch {
    return null;
  }
}

async function loadIncidents(): Promise<DashboardIncident[]> {
  const repoId = process.env.NEXT_PUBLIC_DEFAULT_REPO_ID;
  if (!repoId) return [];
  try {
    const response = await fetch(`${apiUrl()}/api/repositories/${encodeURIComponent(repoId)}/incidents`, { cache: "no-store" });
    return response.ok ? await response.json() as DashboardIncident[] : [];
  } catch {
    return [];
  }
}

export default async function Page() {
  const api = process.env.NEXT_PUBLIC_AGENTGUARD_API_URL ?? process.env.AGENTGUARD_API_URL ?? "http://localhost:3000";
  const [state, incidents] = await Promise.all([loadRepoState(), loadIncidents()]);
  return <Dashboard initialState={state} incidents={incidents} apiUrl={api} installUrl={`${api}/install`} />;
}
