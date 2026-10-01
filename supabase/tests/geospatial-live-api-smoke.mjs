#!/usr/bin/env node
// Phase C2 — REAL live Google Maps Platform smoke test (not mocked).
//
// Proves the actual adapter code (apps/web/lib/geospatial/googlePlacesProvider.ts,
// googleRoutingProvider.ts) round-trips against the real Google APIs with the real
// GOOGLE_MAPS_API_KEY from .env, going through the adapter's real call path (which
// includes Cost Guard internally, per this phase's own constraint) rather than a bare
// fetch written just for this script.
//
// Run with tsx so the real TypeScript adapter modules (not a reimplementation) execute
// directly: `npx tsx supabase/tests/geospatial-live-api-smoke.mjs` from apps/web, or via
// the wrapper below which shells out to `npx tsx` from the repo root.
//
// Checks:
//   1. Geocode a real Brazilian address -> sane lat/lng (within Brazil's rough bounding box).
//   2. Route-insertion detour for the trivial same-route case (candidate pickup AND dropoff
//      == host destination) -> additionalDistanceKm/additionalTimeMin both ~0 and
//      non-negative, against a REAL Routes API response, not a mocked one.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '../../apps/web');

const script = `
import fs from "node:fs";
import path from "node:path";

// Load repo-root .env manually (this standalone script runs outside Next.js's own
// automatic .env.local loading) so GOOGLE_MAPS_API_KEY / SUPABASE_* are available to the
// real adapter/Cost Guard code exactly as they are in the running app.
const envPath = path.resolve(process.cwd(), "../../.env");
for (const line of fs.readFileSync(envPath, "utf8").split("\\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]] = match[2];
}

import { geocodeAddress } from "./lib/geospatial/googlePlacesProvider";
import { evaluateRouteInsertion } from "./lib/geospatial/googleRoutingProvider";

const ORG_ID = "00000000-0000-0000-0000-000000000001"; // real seeded org, for Cost Guard bookkeeping

async function main() {
  const geo = await geocodeAddress(ORG_ID, "Avenida Paulista, 1000, Sao Paulo, SP, Brazil");
  console.log("GEOCODE_RESULT", JSON.stringify(geo));
  if (geo.status !== "ok") {
    console.error("GEOCODE_FAILED");
    process.exitCode = 1;
    return;
  }
  const { lat, lng } = geo.location.coordinates;
  const sane = lat < -19 && lat > -26 && lng < -42 && lng > -50; // rough São Paulo state bounding box
  console.log("GEOCODE_SANE", sane);
  if (!sane) process.exitCode = 1;

  const saoPaulo = { lat: -23.5505, lng: -46.6333 };
  const campinas = { lat: -22.9099, lng: -47.0626 };

  const insertion = await evaluateRouteInsertion(ORG_ID, {
    hostOrigin: saoPaulo,
    hostDestination: campinas,
    candidatePickup: campinas,
    candidateDropoff: campinas,
  });
  console.log("ROUTE_INSERTION_RESULT", JSON.stringify(insertion));
  if (insertion.status !== "ok") {
    console.error("ROUTE_INSERTION_FAILED");
    process.exitCode = 1;
    return;
  }
  const { additionalDistanceKm, additionalTimeMin, baselineDistanceKm, baselineDurationMin } = insertion.result;
  const trivialCaseSane = additionalDistanceKm >= 0 && additionalDistanceKm < 5 && additionalTimeMin >= 0 && additionalTimeMin < 10;
  console.log("BASELINE_DISTANCE_KM", baselineDistanceKm, "BASELINE_DURATION_MIN", baselineDurationMin);
  console.log("ROUTE_INSERTION_TRIVIAL_CASE_SANE", trivialCaseSane);
  if (!trivialCaseSane) process.exitCode = 1;
}

main();
`;

const fs = await import('node:fs');
const tmpFile = path.join(webDir, '__geospatial_live_smoke_tmp.ts');
fs.writeFileSync(tmpFile, script);

// "server-only" unconditionally throws when required outside a Next.js webpack build (it
// exists purely to fail a *client-bundle* compile, not to guard a plain Node/tsx run) — the
// same reason apps/web/vitest.config.ts aliases it out for unit tests. This standalone
// script isn't running under webpack at all, so the installed package's own guard would
// abort every adapter import; temporarily neutralize it for the duration of this one run
// and restore the original file afterwards, regardless of outcome.
const serverOnlyPath = path.resolve(
  webDir,
  '../../node_modules/.pnpm/server-only@0.0.1/node_modules/server-only/index.js',
);
const hasServerOnlyStub = fs.existsSync(serverOnlyPath);
const originalServerOnly = hasServerOnlyStub ? fs.readFileSync(serverOnlyPath, 'utf8') : null;
if (hasServerOnlyStub) {
  fs.writeFileSync(serverOnlyPath, 'module.exports = {};\n');
}

try {
  const result = spawnSync('npx', ['tsx', tmpFile], {
    cwd: webDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
} finally {
  fs.unlinkSync(tmpFile);
  if (hasServerOnlyStub && originalServerOnly !== null) {
    fs.writeFileSync(serverOnlyPath, originalServerOnly);
  }
}
