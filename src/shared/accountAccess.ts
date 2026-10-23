import type { AccountStatus } from './cloud';
import { ACCESS_CACHE_MS, TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH } from './legal';

export function accountAccessError(status: AccountStatus | null | undefined, now = Date.now()): string | undefined {
  if (!status?.configured) return 'Account services are unavailable in this build. Sign-in is required to use Owlio.';
  if (!status.user) return 'Sign in and accept the Terms of Use to use Owlio.';
  if (status.access?.blocked) return status.access.reason || 'This account is suspended. Contact the Owlio administrator.';
  const access = status.access;
  if (!access?.checkedAt || !Number.isFinite(access.checkedAt) || access.checkedAt > now + 60000 || now - access.checkedAt > ACCESS_CACHE_MS)
    return 'Connect to the internet to verify your account access.';
  if (!access.termsAccepted || access.termsVersion !== TERMS_VERSION || access.privacyVersion !== PRIVACY_VERSION || access.policyHash !== POLICY_HASH)
    return 'Accept the current Terms of Use, Privacy Notice and required basic usage reporting to continue.';
}
