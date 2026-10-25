import type { AccountStatus } from './cloud';
import { ACCESS_CACHE_MS, TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH } from './legal';

/**
 * Guest mode: with no signed-in account, every local feature is available and
 * no usage reporting is collected. Sign-in is optional; the account checks below
 * apply only once a person chooses to sign in.
 */
export function isGuest(status: AccountStatus | null | undefined): boolean {
  return !status?.user;
}

export function accountAccessError(status: AccountStatus | null | undefined, now = Date.now()): string | undefined {
  if (!status?.user) return undefined;
  if (status.access?.blocked) return status.access.reason || 'This account is suspended. Contact the Owlio administrator.';
  const access = status.access;
  if (!access?.checkedAt || !Number.isFinite(access.checkedAt) || access.checkedAt > now + 60000 || now - access.checkedAt > ACCESS_CACHE_MS)
    return 'Connect to the internet to verify your account access, or sign out to continue as a guest.';
  if (!access.termsAccepted || access.termsVersion !== TERMS_VERSION || access.privacyVersion !== PRIVACY_VERSION || access.policyHash !== POLICY_HASH)
    return 'Accept the current Terms of Use, Privacy Notice and basic usage reporting to use your account, or sign out to continue as a guest.';
}
