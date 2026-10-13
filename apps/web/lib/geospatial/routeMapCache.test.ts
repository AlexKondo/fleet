import { describe, expect, it } from "vitest";
import { RouteMapCache, routeMapCacheKey } from "./routeMapCache";

describe("RouteMapCache", () => {
  it("normalises org + origin + destination + language in the key", () => {
    expect(routeMapCacheKey("o", "  Av.  Paulista ", "X", "pt-BR")).toBe(routeMapCacheKey("o", "av. paulista", "x", "pt-BR"));
    expect(routeMapCacheKey("o", "a", "b", "pt-BR")).not.toBe(routeMapCacheKey("p", "a", "b", "pt-BR"));
    expect(routeMapCacheKey("o", "a", "b", "pt-BR")).not.toBe(routeMapCacheKey("o", "a", "b", "en"));
  });
  it("expires after the TTL", () => {
    let t = 0;
    const c = new RouteMapCache<number>(50, 1000, () => t);
    c.set("k", 1);
    t = 999;
    expect(c.get("k")).toBe(1);
    t = 1000;
    expect(c.get("k")).toBeUndefined();
  });
  it("evicts the least recently used beyond max", () => {
    const c = new RouteMapCache<number>(2, 1000, () => 0);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(2);
  });
});
