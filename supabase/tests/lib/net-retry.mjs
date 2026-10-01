// F2: bounded retry with backoff for NETWORK-LEVEL fetch failures ONLY (fetch() itself throws: "fetch failed",
// ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, UND_ERR_*). A response of any HTTP status is returned untouched (never
// retried), so assertion results and 4xx/5xx semantics are not affected. Every retry is logged on stderr as
// "NET-RETRY ..." so the suite runner can report the diagnosis.
if (!globalThis.__netRetryInstalled) {
  globalThis.__netRetryInstalled = true;
  const original = globalThis.fetch;
  const NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EPIPE|UND_ERR|socket hang up|network/i;
  const describe = (e) => `${e?.name ?? 'Error'}: ${e?.message ?? e}${e?.cause ? ` (cause: ${e.cause.code ?? e.cause.message ?? e.cause})` : ''}`;
  globalThis.fetch = async function retryingFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const host = (() => { try { return new URL(url).host; } catch { return '?'; } })();
    const delays = [500, 1500, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await original(input, init);
      } catch (e) {
        const isAbort = e?.name === 'AbortError';
        if (isAbort || !NETWORK.test(describe(e)) || attempt >= delays.length) throw e;
        console.error(`NET-RETRY ${attempt + 1}/${delays.length} ${init?.method ?? 'GET'} ${host} after ${describe(e)}`);
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  };
}
