export const PR402_FACILITATOR_URL_PRODUCTION = 'https://ipay.sh';
export const PR402_FACILITATOR_URL_PREVIEW = 'https://preview.ipay.sh';

const CAPABILITIES_SUFFIX = /\/api\/v1\/facilitator\/capabilities\/?$/;

export function facilitatorBaseUrl(
  capabilitiesUrl: string | undefined | null,
  fallbackBaseUrl: string,
): string {
  const raw = (capabilitiesUrl?.trim() || fallbackBaseUrl.trim());
  return raw.replace(CAPABILITIES_SUFFIX, '').replace(/\/$/, '');
}

export function isExactRailScheme(scheme: unknown): boolean {
  return scheme === 'exact' || scheme === 'v2:solana:exact';
}

export function pickExactAcceptLine<T extends { scheme?: unknown }>(
  accepts: T[] | undefined,
): T | undefined {
  return accepts?.find((a) => isExactRailScheme(a.scheme));
}

export function canonicalAcceptedForBuild<T extends { scheme?: unknown }>(accepted: T): T {
  if (accepted?.scheme === 'v2:solana:exact') {
    return { ...accepted, scheme: 'exact' };
  }
  return accepted;
}
