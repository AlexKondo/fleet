// Preloaded into the Next server (NODE_OPTIONS --require) by start-server.mjs --fetch-log FILE.
// Logs every outgoing server-side request to Supabase as one JSON line {t, method, path, bearer}; the bearer kind is
// derived by comparing with the configured keys (no key value is ever written).
const fs = require("node:fs");
const file = process.env.FETCH_LOG_FILE;
const origin = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (file && origin && typeof globalThis.fetch === "function") {
  const original = globalThis.fetch;
  globalThis.fetch = function patchedFetch(input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
      if (url.startsWith(origin)) {
        const headers = new Headers((init && init.headers) || (input && input.headers) || {});
        const auth = (headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const bearer = !auth ? "none" : auth === anon ? "anon" : auth === service ? "service" : "user";
        const u = new URL(url);
        fs.appendFileSync(file, JSON.stringify({ t: Date.now(), method: (init && init.method) || (input && input.method) || "GET", path: u.pathname, bearer }) + "\n");
      }
    } catch { /* logging must never break a request */ }
    return original.apply(this, arguments);
  };
}
