"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import { getTripRouteMap, type RouteMapResult } from "./routeMapActions";
import "./routeMap.css";

/**
 * Embedded route map card (Google Static Maps rendered server-side, see routeMapActions.ts). Loaded lazily AFTER
 * the surrounding screen: it never blocks or delays anything else, and any failure just hides it (or shows one
 * muted line). One server call per distinct origin+destination: results are kept in a module-level map (survives
 * re-renders / remounts), the in-flight promise is shared (React StrictMode double effects, fast re-plans) and the
 * request is debounced. The image is kept in memory only (max 6, this tab): never in sessionStorage/localStorage.
 */

const memory = new Map<string, RouteMapResult>();
const inflight = new Map<string, Promise<RouteMapResult>>();
const DEBOUNCE_MS = 350;

function load(key: string, originText: string, destinationText: string): Promise<RouteMapResult> {
  const cached = memory.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = getTripRouteMap({ originText, destinationText })
    .catch((): RouteMapResult => ({ status: "unavailable", reason: "map_unavailable" }))
    .then((result) => {
      // Transient failures are not cached: a retry (new plan) may succeed.
      if (result.status === "ok") {
        if (memory.size >= 6) memory.delete(memory.keys().next().value as string);
        memory.set(key, result);
      }
      inflight.delete(key);
      return result;
    });
  inflight.set(key, p);
  return p;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export function formatRouteDuration(minutes: number, t: Dictionary["routeMap"]): string {
  const total = Math.max(1, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return fill(t.m, { m });
  if (m === 0) return fill(t.h, { h });
  return fill(t.hm, { h, m });
}

type State = { phase: "loading" } | { phase: "done"; result: RouteMapResult };

export function RouteMapCard({
  dict,
  locale,
  originText,
  destinationText,
  testId = "route-map",
}: {
  dict: Dictionary;
  locale: string;
  originText: string;
  destinationText: string;
  testId?: string;
}) {
  const t = dict.routeMap;
  const origin = originText.trim();
  const destination = destinationText.trim();
  const key = `${origin}\u0001${destination}`;
  const [state, setState] = useState<State>(() => {
    const cached = memory.get(key);
    return cached ? { phase: "done", result: cached } : { phase: "loading" };
  });
  const [trackedKey, setTrackedKey] = useState(key);
  if (trackedKey !== key) {
    setTrackedKey(key);
    const cached = memory.get(key);
    setState(cached ? { phase: "done", result: cached } : { phase: "loading" });
  }

  useEffect(() => {
    if (!origin || !destination) return;
    let cancelled = false;
    const cachedNow = memory.has(key);
    const timer = setTimeout(
      () => {
        void load(key, origin, destination).then((result) => {
          if (!cancelled) setState({ phase: "done", result });
        });
      },
      cachedNow ? 0 : DEBOUNCE_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, origin, destination]);

  if (!origin || !destination) return null;

  if (state.phase === "loading") {
    return (
      <section className="fm-routemap" data-testid={testId} data-state="loading" aria-busy="true" aria-label={t.title}>
        <h3 className="fm-routemap-title">{t.title}</h3>
        <div className="fm-routemap-skeleton" role="status">
          <span className="fm-routemap-sr">{t.loading}</span>
        </div>
      </section>
    );
  }

  const r = state.result;
  if (r.status !== "ok") {
    // The rider's own typing problems (disabled / not signed in / place not found) stay silent; real outages show
    // one muted line. Either way the rest of the page is untouched.
    if (r.reason === "disabled" || r.reason === "not_authenticated" || r.reason === "invalid_input" || r.reason === "place_not_found") {
      return null;
    }
    return (
      <p className="fm-routemap-muted" data-testid={`${testId}-unavailable`} role="status">
        {t.unavailable}
      </p>
    );
  }

  const alt = fill(t.alt, { origin: r.originLabel, destination: r.destinationLabel });
  return (
    <section className="fm-routemap" data-testid={testId} data-state="ready" aria-busy="false" aria-label={t.title}>
      <h3 className="fm-routemap-title">{t.title}</h3>
      <div className="fm-routemap-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL produced by the server action; next/image adds nothing here */}
        <img className="fm-routemap-img" src={r.imageDataUrl} alt={alt} width={640} height={360} decoding="async" data-testid={`${testId}-img`} />
        <div className="fm-routemap-chip" data-testid={`${testId}-chip`}>
          <span className="fm-routemap-chip-main">
            <strong data-testid={`${testId}-km`}>{fill(t.dist, { km: r.distanceKm.toLocaleString(locale, { maximumFractionDigits: 1 }) })}</strong>
            <span aria-hidden="true"> · </span>
            <strong data-testid={`${testId}-min`}>{formatRouteDuration(r.durationMin, t)}</strong>
          </span>
          <span className="fm-routemap-chip-sub">{t.estimated}</span>
        </div>
      </div>
      <dl className="fm-routemap-labels">
        <div>
          <dt>
            <span className="fm-routemap-pin fm-routemap-pin-a" aria-hidden="true">A</span>
            {t.origin}
          </dt>
          <dd title={r.originLabel}>{r.originLabel}</dd>
        </div>
        <div>
          <dt>
            <span className="fm-routemap-pin fm-routemap-pin-b" aria-hidden="true">B</span>
            {t.destination}
          </dt>
          <dd title={r.destinationLabel}>{r.destinationLabel}</dd>
        </div>
      </dl>
      {r.approximate ? <p className="fm-routemap-note">{t.approx}</p> : null}
    </section>
  );
}
