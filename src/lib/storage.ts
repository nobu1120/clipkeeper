import type {
  ConnectionState,
  PlanState,
  RegisteredDatabase,
  UsageState,
} from "./types";

const KEYS = {
  connection: "clipkeep.connection",
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

export async function getConnection(): Promise<ConnectionState> {
  return getLocal(KEYS.connection, {
    token: null,
    connectedAt: null,
    workspaceName: null,
  });
}

export async function setConnection(state: ConnectionState): Promise<void> {
  await setLocal(KEYS.connection, state);
}

export async function clearConnection(): Promise<void> {
  await setLocal(KEYS.connection, {
    token: null,
    connectedAt: null,
    workspaceName: null,
  });
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

export async function getRegisteredDatabases(): Promise<RegisteredDatabase[]> {
  return getLocal(KEYS.databases, []);
}

export async function setRegisteredDatabases(
  databases: RegisteredDatabase[]
): Promise<void> {
  await setLocal(KEYS.databases, databases);
}
