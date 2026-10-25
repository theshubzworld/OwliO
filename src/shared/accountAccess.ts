import type { AccountStatus } from './cloud';
import { ACCESS_CACHE_MS, TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH } from './legal';

/**
 * Guest mode: with no signed-in account (or a build without account services),
 * every local feature is available and no usage data is reported.
 */
export function isGuest(status: AccountStatus | null | undefined): boolean {
  return !status?.configured || !status.user;
}

/**
 * Returns a reason when a signed-in account cannot use the app (suspended,
 * terms not accepted, or access cache expired). Guests always get undefined.
 */
export function accountAccessError(status: AccountStatus | null | undefined, now = Date.now()): string | undefined {
  if (isGuest(status)) return;
  const signOutHint = ' Or sign out to continue as a guest.';
  if (status!.access?.blocked) return (status!.access.reason || 'This account is suspended. Contact the Owlio administrator.') + signOutHint;
  const access = status!.access;
  if (!access?.checkedAt || !Number.isFinite(access.checkedAt) || access.checkedAt > now + 60000 || now - access.checkedAt > ACCESS_CACHE_MS)
    return 'Connect to the internet to verify your account access.' + signOutHint;
  if (!access.termsAccepted || access.termsVersion !== TERMS_VERSION || access.privacyVersion !== PRIVACY_VERSION || access.policyHash !== POLICY_HASH)
    return 'Accept the current Terms of Use and Privacy Notice to continue with your account.' + signOutHint;
}

/** Usage reporting runs only for a verified, signed-in account. Never for guests. */
export function reportingAllowed(status: AccountStatus | null | undefined, now = Date.now()): boolean {
  return !isGuest(status) && !accountAccessError(status, now);
}
