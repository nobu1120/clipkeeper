import type {
  ConnectionState,
  NotionConnection,
  PlanState,
  RegisteredDatabase,
  UsageState,
} from "./types";

const KEYS = {
  connections: "clipkeep.connections",
  activeConnectionId: "clipkeep.activeConnectionId",
  usage: "clipkeep.usage",
  plan: "clipkeep.plan",
  databases: "clipkeep.databases",
} as const;

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

async function setLocal<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getConnections(): Promise<NotionConnection[]> {
  return getLocal(KEYS.connections, []);
}

export async function setConnections(connections: NotionConnection[]): Promise<void> {
  await setLocal(KEYS.connections, connections);
}

export async function getActiveConnectionId(): Promise<string | null> {
  return getLocal<string | null>(KEYS.activeConnectionId, null);
}

export async function setActiveConnectionId(id: string | null): Promise<void> {
  await setLocal(KEYS.activeConnectionId, id);
}

export async function getActiveConnection(): Promise<NotionConnection | null> {
  const [connections, activeId] = await Promise.all([getConnections(), getActiveConnectionId()]);
  return connections.find((c) => c.id === activeId) ?? connections[0] ?? null;
}

export async function getConnection(): Promise<ConnectionState> {
  const active = await getActiveConnection();
  return active
    ? { token: active.token, connectedAt: active.connectedAt, workspaceName: active.workspaceName }
    : { token: null, connectedAt: null, workspaceName: null };
}

function currentPeriodStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function getUsage(): Promise<UsageState> {
  const usage = await getLocal<UsageState>(KEYS.usage, {
    periodStart: currentPeriodStart(),
    clipCount: 0,
  });
  // Roll over to a new period automatically.
  if (usage.periodStart !== currentPeriodStart()) {
    const reset: UsageState = { periodStart: currentPeriodStart(), clipCount: 0 };
    await setLocal(KEYS.usage, reset);
    return reset;
  }
  return usage;
}

export async function incrementUsage(): Promise<UsageState> {
  const usage = await getUsage();
  const updated: UsageState = { ...usage, clipCount: usage.clipCount + 1 };
  await setLocal(KEYS.usage, updated);
  return updated;
}

export async function getPlan(): Promise<PlanState> {
  return getLocal(KEYS.plan, { tier: "free" });
}

export async function setPlan(plan: PlanState): Promise<void> {
  await setLocal(KEYS.plan, plan);
}

export async function getRegisteredDatabases(connectionId?: string): Promise<RegisteredDatabase[]> {
  const all = await getLocal<RegisteredDatabase[]>(KEYS.databases, []);
  return connectionId ? all.filter((d) => d.connectionId === connectionId) : all;
}

export async function setRegisteredDatabases(
  databases: RegisteredDatabase[]
): Promise<void> {
  await setLocal(KEYS.databases, databases);
}
