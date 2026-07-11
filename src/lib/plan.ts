import { FREE_MAX_DATABASES, FREE_MONTHLY_CLIP_LIMIT } from "./types";
import {
  decrementUsage,
  getPlan,
  getRegisteredDatabases,
  getUsage,
  incrementUsage,
  setPlan,
  withUsageLock,
} from "./storage";

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  remaining: number | "unlimited";
}

const QUOTA_EXCEEDED_REASON = `無料プランは月${FREE_MONTHLY_CLIP_LIMIT}件までです。Proにアップグレードすると無制限になります。`;

// Checks the quota and, if allowed, immediately reserves a slot by
// incrementing usage — as a single lock-guarded operation. A separate
// check-then-later-increment (the previous approach) leaves a window where
// two concurrent saves (e.g. context-menu + popup) can both pass the check
// before either increments, letting usage exceed the free limit. Callers
// must release the reservation via releaseClipQuota() if the save ends up
// failing after this succeeds.
export async function reserveClipQuota(): Promise<QuotaCheck> {
  return withUsageLock(async () => {
    const plan = await getPlan();
    if (plan.tier === "pro") {
      await incrementUsage();
      return { allowed: true, remaining: "unlimited" };
    }
    const usage = await getUsage();
    const remaining = FREE_MONTHLY_CLIP_LIMIT - usage.clipCount;
    if (remaining <= 0) {
      return { allowed: false, reason: QUOTA_EXCEEDED_REASON, remaining: 0 };
    }
    await incrementUsage();
    return { allowed: true, remaining: remaining - 1 };
  });
}

export async function releaseClipQuota(): Promise<void> {
  await withUsageLock(() => decrementUsage());
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
