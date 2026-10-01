/**
 * C7b: provider failure reasons are FIXED CODES, never the raw error message. The Geocoding adapter passes the
 * API key as a URL query parameter (the legacy Geocoding API has no header option), and some fetch implementations
 * and polyfills put the full request URL into an error message - so `err.message` must never be echoed to a
 * caller, a log line, a server-action response or the HTML. Reasons are internal (the search wrapper maps them to
 * constants before anything reaches the browser) but they are also written to logs, hence the redaction.
 */
export function providerErrorReason(prefix: "geocode" | "places" | "routes", err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return `${prefix}_timeout`;
  return `${prefix}_network_error`;
}

/** Removes the API key (and any `key=` query value) from arbitrary text, e.g. before logging. */
export function redactSecrets(text: string, secrets: (string | undefined)[] = [process.env.GOOGLE_MAPS_API_KEY]): string {
  let out = text.replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  }
  return out;
}
