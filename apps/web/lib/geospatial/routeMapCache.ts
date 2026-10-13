/**
 * Small per-instance LRU + TTL cache of OK route-map results (never failures). Keyed by organization + normalised
 * origin + normalised destination + Static Maps language. A hit avoids every provider call (geocode x2, Routes,
 * Static Maps); the per-user daily view cap is still consumed by the caller. Serverless instances do not share it:
 * it is a best-effort saver, the Cost Guard daily caps remain the real ceiling.
 */
export const ROUTE_MAP_CACHE_MAX = 50;
export const ROUTE_MAP_CACHE_TTL_MS = 10 * 60_000;

export function normalizePlaceText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function routeMapCacheKey(orgId: string, origin: string, destination: string, language: string): string {
  return [orgId, normalizePlaceText(origin), normalizePlaceText(destination), language].join("\u0001");
}

export class RouteMapCache<T> {
  private readonly map = new Map<string, { value: T; expiresAt: number }>();
  constructor(
    private readonly max = ROUTE_MAP_CACHE_MAX,
    private readonly ttlMs = ROUTE_MAP_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number {
    return this.map.size;
  }
}
