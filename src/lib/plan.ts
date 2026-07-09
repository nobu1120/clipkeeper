import { FREE_MAX_DATABASES, FREE_MONTHLY_CLIP_LIMIT } from "./types";
import { getPlan, getRegisteredDatabases, getUsage, setPlan } from "./storage";

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  remaining: number | "unlimited";
}

export async function checkClipQuota(): Promise<QuotaCheck> {
  const plan = await getPlan();
  if (plan.tier === "pro") {
    return { allowed: true, remaining: "unlimited" };
  }
  const usage = await getUsage();
  const remaining = FREE_MONTHLY_CLIP_LIMIT - usage.clipCount;
  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `無料プランは月${FREE_MONTHLY_CLIP_LIMIT}件までです。Proにアップグレードすると無制限になります。`,
      remaining: 0,
    };
  }
  return { allowed: true, remaining };
}

export async function checkDatabaseLimit(): Promise<QuotaCheck> {
  const plan = await getPlan();
  if (plan.tier === "pro") {
    return { allowed: true, remaining: "unlimited" };
  }
  const databases = await getRegisteredDatabases();
  const remaining = FREE_MAX_DATABASES - databases.length;
  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `無料プランはデータベース${FREE_MAX_DATABASES}件までです。Proにアップグレードすると複数登録できます。`,
      remaining: 0,
    };
  }
  return { allowed: true, remaining };
}

/**
 * MVP license check only. This is a local, client-side placeholder so the
 * upgrade UX can be wired end-to-end before a real payment backend exists.
 * It is NOT tamper-proof — replace with server-side verification (e.g. a
 * Stripe webhook issuing a signed token this function verifies) before
 * relying on it for real revenue.
 */
export function isPlausibleLicenseKeyFormat(key: string): boolean {
  return /^CLIPKEEP-PRO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key.trim());
}

export async function activateLicense(licenseKey: string): Promise<boolean> {
  const trimmed = licenseKey.trim();
  if (!isPlausibleLicenseKeyFormat(trimmed)) {
    return false;
  }
  await setPlan({ tier: "pro", licenseKey: trimmed });
  return true;
}

export async function deactivateLicense(): Promise<void> {
  await setPlan({ tier: "free" });
}
