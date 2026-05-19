/**
 * In-memory cache for Yukk access tokens.
 *
 * Yukk tokens expire in 900s (15 min). We store the token with its expiry
 * and treat it as stale 60s before the actual expiry to avoid edge-case
 * failures where a token expires mid-request.
 */

const SAFETY_MARGIN_MS = 60_000; // 60 seconds

export interface CachedToken {
  accessToken: string;
  expiresAt: number; // Date.now() based ms timestamp
}

let cachedToken: CachedToken | null = null;

/**
 * Returns a cached token if it is still valid (with safety margin),
 * or `null` if no token is cached or it has expired.
 */
export function getCachedToken(): string | null {
  if (!cachedToken) return null;
  if (Date.now() >= cachedToken.expiresAt - SAFETY_MARGIN_MS) {
    cachedToken = null;
    return null;
  }
  return cachedToken.accessToken;
}

/**
 * Stores a token in the cache.
 * @param accessToken - The Bearer token string
 * @param expiresIn - Token lifetime in seconds (e.g. 900)
 */
export function setCachedToken(accessToken: string, expiresIn: number): void {
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Clears the cached token. Useful for testing or forced refresh.
 */
export function clearCachedToken(): void {
  cachedToken = null;
}
