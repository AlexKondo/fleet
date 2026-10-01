import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  carpoolOfferTransitions,
  invalidateLiveRequest,
  rideRequestTransitions,
} from "@fleet/domain";

/**
 * Ties the SQL transition guards in 0059/0060 to the pure domain functions (Phase C1/C4), so
 * the two can never silently drift. Every guard carries a
 * `-- DOMAIN-MIRROR <module.function>: <allowed from-statuses>` marker, but the marker is only
 * a label: this test parses the ACTUAL guard expression that follows it and compares THAT to
 * what the domain function allows (computed by calling it for every status). It also proves,
 * by mutating the SQL text in memory, that a drifted guard would be caught.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);
const MIGRATION_FILES = [
  "0059_carpool_lifecycle_rpcs.sql",
  "0060_carpool_write_lockdown_and_server_only_create.sql",
  "0062_carpool_request_privacy_and_reason.sql",
];

const REQUEST_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED", "INVALIDATED"] as const;
const OFFER_STATUSES = ["draft", "active", "disabled", "completed"] as const;

function allowedRequestFrom(fn: (s: { status: (typeof REQUEST_STATUSES)[number] }) => { ok: boolean }) {
  return REQUEST_STATUSES.filter((status) => fn({ status }).ok).sort();
}

function allowedOfferFrom(
  fn: (s: { status: (typeof OFFER_STATUSES)[number]; seatsOffered: number; seatsAvailable: number }) => { ok: boolean },
) {
  return OFFER_STATUSES.filter((status) => fn({ status, seatsOffered: 3, seatsAvailable: 3 }).ok).sort();
}

const DOMAIN_ALLOWED: Record<string, string[]> = {
  "rideRequest.accept": allowedRequestFrom(rideRequestTransitions.accept),
  "rideRequest.reject": allowedRequestFrom(rideRequestTransitions.reject),
  "rideRequest.cancel": allowedRequestFrom(rideRequestTransitions.cancel),
  "rideRequest.expire": allowedRequestFrom(rideRequestTransitions.expire),
  "revalidation.invalidateLiveRequest": allowedRequestFrom(invalidateLiveRequest),
  "carpoolOffer.enableOffer": allowedOfferFrom((s) => carpoolOfferTransitions.enableOffer(s, { seatsOffered: 2 })),
  "carpoolOffer.updateSeats": allowedOfferFrom((s) => carpoolOfferTransitions.updateSeats(s, { seatsOffered: 2 })),
  "carpoolOffer.disableOffer": allowedOfferFrom((s) => carpoolOfferTransitions.disableOffer(s)),
};

interface ParsedGuard {
  fn: string;
  markerStatuses: string[];
  allowed: string[];
}

/**
 * Extracts, for every DOMAIN-MIRROR marker, the allowed from-statuses implied by the guard that
 * follows it. Supported forms (an `if` guard raises when true):
 *   if <subj>.status <> 'A' then            -> allowed {A}
 *   if <subj>.status not in ('A','B') then  -> allowed {A,B}
 *   if <subj>.status = 'X' then (chain)     -> allowed = universe - {X...}
 *   ... status = 'A';  (guarded UPDATE)     -> allowed {A}
 * A chain of guards must share one subject; the walk stops at the first line that is neither
 * part of the chain nor a raise / end if / comment / blank.
 */
function extractGuards(sql: string): ParsedGuard[] {
  const lines = sql.split(/\r?\n/);
  const out: ParsedGuard[] = [];
  const guardRe = /^\s*if\s+([\w.]+\.status)\s+(<>|not in|=)\s*(?:\(([^)]*)\)|'(\w+)')\s+then\s*$/;
  const updateRe = /\bstatus\s*=\s*'(\w+)'\s*;?\s*$/;
  lines.forEach((line, idx) => {
    const m = /^\s*-- DOMAIN-MIRROR ([\w.]+): (.+)$/.exec(line);
    if (!m) return;
    const fn = m[1]!;
    const universe: readonly string[] = fn.startsWith("carpoolOffer.") ? OFFER_STATUSES : REQUEST_STATUSES;
    const markerStatuses = m[2]!.split(",").map((x) => x.trim()).sort();
    let subject: string | null = null;
    let allowedSet: string[] | null = null;
    const rejected: string[] = [];
    for (let i = idx + 1; i < Math.min(lines.length, idx + 12); i++) {
      const l = lines[i]!;
      const g = guardRe.exec(l);
      if (g) {
        if (subject && g[1] !== subject) break;
        subject = g[1]!;
        const list = (g[3] ?? g[4] ?? "").split(",").map((x) => x.replace(/['\s]/g, "")).filter(Boolean);
        if (g[2] === "=") rejected.push(...list);
        else allowedSet = list; // "<>" and "not in": the listed statuses are the allowed ones
        continue;
      }
      if (subject === null) {
        const u = updateRe.exec(l);
        if (u) {
          allowedSet = [u[1]!];
          break;
        }
        continue; // lines of a guarded UPDATE before its WHERE
      }
      if (/^\s*(raise exception|end if;|--|$)/.test(l)) continue;
      break;
    }
    const allowed = (allowedSet ?? universe.filter((s) => !rejected.includes(s))).slice().sort();
    out.push({ fn, markerStatuses, allowed });
  });
  return out;
}

function guardsFor(sql: string) {
  const map = new Map<string, string[][]>();
  for (const g of extractGuards(sql)) map.set(g.fn, [...(map.get(g.fn) ?? []), g.allowed]);
  return map;
}

describe("SQL guards (parsed from the actual guard expression) mirror the pure domain transitions", () => {
  const sql = MIGRATION_FILES.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")).join("\n");
  const guards = guardsFor(sql);

  it("has a guard for every mirrored domain function", () => {
    expect([...guards.keys()].sort()).toEqual(Object.keys(DOMAIN_ALLOWED).sort());
  });

  for (const [fn, allowed] of Object.entries(DOMAIN_ALLOWED)) {
    it(`${fn}: the SQL guard allows exactly the domain's from-statuses (${allowed.join(", ")})`, () => {
      const sets = guards.get(fn) ?? [];
      expect(sets.length).toBeGreaterThan(0);
      for (const set of sets) expect(set).toEqual(allowed);
    });
  }

  it("the marker comments agree with the parsed guards too", () => {
    for (const g of extractGuards(sql)) expect(g.markerStatuses, g.fn).toEqual(g.allowed);
  });

  describe("mutation checks: a guard that drifts from the domain is detected", () => {
    function mutateFirstGuardAfter(source: string, fn: string, from: RegExp, to: string): string {
      const lines = source.split("\n");
      const marker = lines.findIndex((l) => l.includes(`DOMAIN-MIRROR ${fn}:`));
      expect(marker).toBeGreaterThanOrEqual(0);
      for (let i = marker + 1; i < marker + 6; i++) {
        if (from.test(lines[i]!)) {
          lines[i] = lines[i]!.replace(from, to);
          return lines.join("\n");
        }
      }
      throw new Error("guard line not found for mutation");
    }

    it("accept guard widened to also allow REJECTED is detected", () => {
      const mutated = mutateFirstGuardAfter(sql, "rideRequest.accept", /<> 'PENDING'/, "not in ('PENDING', 'REJECTED')");
      const set = guardsFor(mutated).get("rideRequest.accept")![0]!;
      expect(set).toEqual(["PENDING", "REJECTED"]);
      expect(set).not.toEqual(DOMAIN_ALLOWED["rideRequest.accept"]);
    });

    it("cancel guard narrowed to PENDING only is detected", () => {
      const mutated = mutateFirstGuardAfter(sql, "rideRequest.cancel", /not in \('PENDING', 'ACCEPTED'\)/, "<> 'PENDING'");
      expect(guardsFor(mutated).get("rideRequest.cancel")![0]).not.toEqual(DOMAIN_ALLOWED["rideRequest.cancel"]);
    });

    it("enableOffer guard that stops rejecting 'active' is detected", () => {
      const mutated = mutateFirstGuardAfter(sql, "carpoolOffer.enableOffer", /v_offer\.status = 'active'/, "v_offer.status = 'completed'");
      expect(guardsFor(mutated).get("carpoolOffer.enableOffer")![0]).not.toEqual(DOMAIN_ALLOWED["carpoolOffer.enableOffer"]);
    });

    it("expire guarded UPDATE widened is detected", () => {
      const mutated = mutateFirstGuardAfter(sql, "rideRequest.expire", /status = 'PENDING';/, "status = 'ACCEPTED';");
      const sets = guardsFor(mutated).get("rideRequest.expire")!;
      expect(sets.some((s) => JSON.stringify(s) !== JSON.stringify(DOMAIN_ALLOWED["rideRequest.expire"]))).toBe(true);
    });
  });
});

describe("sanity: the domain really does reject terminal states (guards the test itself)", () => {
  it("accept/cancel allowed sets", () => {
    expect(DOMAIN_ALLOWED["rideRequest.accept"]).toEqual(["PENDING"]);
    expect(DOMAIN_ALLOWED["rideRequest.cancel"]).toEqual(["ACCEPTED", "PENDING"]);
  });
});
