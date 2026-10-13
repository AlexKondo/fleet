"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import type { RouteMapResult } from "./routeMapActions";
import "./routeMap.css";

/**
 * Embedded route map card (Google Static Maps rendered server-side, see routeMapActions.ts). Loaded lazily AFTER
 * the surrounding screen: it never blocks or delays anything else, and any failure just hides it (or shows one
 * muted line). One server call per distinct origin+destination: results are kept in a module-level map (survives
 * re-renders / remounts), the in-flight promise is shared (React StrictMode double effects, fast re-plans) and the
 * request is debounced. The image is kept in memory only (max 6, this tab): never in sessionStorage/localStorage.
 */

const memory = new Map<string, RouteMapResult>();
// One in-flight request per distinct pair, shared by every subscriber (StrictMode double effects, fast re-renders). It is a plain
// fetch to POST /api/geo/route-map (not a server action, so it never queues behind the plan submit) and it is really aborted
// when the last subscriber goes away before it settled (the texts changed again).
const inflight = new Map<string, { promise: Promise<RouteMapResult>; controller: AbortController; subscribers: number }>();
const DEBOUNCE_MS = 350;
const UNAVAILABLE: RouteMapResult = { status: "unavailable", reason: "map_unavailable" };

async function fetchMap(originText: string, destinationText: string, signal: AbortSignal): Promise<RouteMapResult> {
  try {
    const res = await fetch("/api/geo/route-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ originText, destinationText }),
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (res.status === 401) return { status: "unavailable", reason: "not_authenticated" };
    if (!res.ok) return UNAVAILABLE;
    const json = (await res.json()) as RouteMapResult;
    return json && (json.status === "ok" || json.status === "unavailable") ? json : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

function load(key: string, originText: string, destinationText: string): { promise: Promise<RouteMapResult>; release: () => void } {
  const cached = memory.get(key);
  if (cached) return { promise: Promise.resolve(cached), release: () => {} };
  let entry = inflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    const promise = fetchMap(originText, destinationText, controller.signal).then((result) => {
      // Transient failures (and aborted calls) are not cached: a retry may succeed.
      if (result.status === "ok") {
        if (memory.size >= 6) memory.delete(memory.keys().next().value as string);
        memory.set(key, result);
      }
      if (inflight.get(key)?.controller === controller) inflight.delete(key);
      return result;
    });
    entry = { promise, controller, subscribers: 0 };
    inflight.set(key, entry);
  }
  const current = entry;
  current.subscribers += 1;
  let released = false;
  return {
    promise: current.promise,
    release: () => {
      if (released) return;
      released = true;
      current.subscribers -= 1;
      // grace tick: a StrictMode remount re-subscribes immediately and must not cancel the request
      setTimeout(() => {
        if (current.subscribers <= 0 && inflight.get(key) === current) {
          inflight.delete(key);
          current.controller.abort();
        }
      }, 50);
    },
  };
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
  debounceMs = DEBOUNCE_MS,
  onResult,
}: {
  dict: Dictionary;
  locale: string;
  originText: string;
  destinationText: string;
  testId?: string;
  /** Wait this long after the last change of the texts before asking the server (default 350ms). */
  debounceMs?: number;
  /** Called with every settled result for the CURRENT texts (cached or fresh), e.g. to fill the trip distance. */
  onResult?: (result: RouteMapResult) => void;
}) {
  const t = dict.routeMap;
  const origin = originText.trim();
  const destination = destinationText.trim();
  const key = `${origin}\u0001${destination}`;
  const [state, setState] = useState<State>(() => {
    const cached = memory.get(key);
    return cached ? { phase: "done", result: cached } : { phase: "loading" };
  });
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
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
    let release: () => void = () => {};
    const timer = setTimeout(
      () => {
        const loading = load(key, origin, destination);
        release = loading.release;
        void loading.promise.then((result) => {
          if (cancelled) return;
          setState({ phase: "done", result });
          onResultRef.current?.(result);
        });
      },
      cachedNow ? 0 : debounceMs,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      release();
    };
  }, [key, origin, destination, debounceMs]);

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
