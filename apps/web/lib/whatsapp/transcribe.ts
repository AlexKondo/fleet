/**
 * Voice notes -> text with OpenAI (whisper-1). Server-only by use (the key never leaves the server). Pure of framework imports so it can be
 * tested with a fake fetch. Never throws.
 */
export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: "not_configured" | "too_large" | "invalid" | "failed" | "empty" };

export interface TranscribeDeps {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
}

/** ~3 MB of audio: a voice note of a couple of minutes. */
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 40_000;
// place names and words the assistant hears all day, to help the recognizer
const PROMPT = "FleetMind, reserva de veículo, carona, vagas, Garagem Matriz, São Paulo, Campinas, Rio de Janeiro, Guarulhos, aeroporto, saída, retorno, amanhã.";

function extensionFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  return "ogg"; // WhatsApp voice notes are Opus in an Ogg container
}

/**
 * Whisper sometimes "hears" a subtitle credit or a sign-off in silence or noise (a known artefact). Those never are a request, so they are
 * treated as an empty recording instead of being sent to the assistant.
 */
export function isPhantomText(text: string): boolean {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  return (
    t === "" ||
    /(legendas? pela comunidade|amara org|legendado por|tradu[cç][aã]o e legendas|subtitles by|transcri[cç][aã]o por)/.test(t) ||
    /^(obrigado|obrigada|obrigado por assistir|valeu|tchau|inscreva se|até a próxima)( .{0,25})?$/.test(t)
  );
}

export async function transcribeAudio(audioBase64: string, mimeType: string, deps: TranscribeDeps = {}): Promise<TranscribeResult> {
  // same naming as API_CLAUDE; OPENAI_API_KEY is accepted too
  const apiKey = deps.apiKey ?? process.env.API_OPENAI ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const clean = String(audioBase64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { ok: false, reason: "invalid" };
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length === 0) return { ok: false, reason: "invalid" };
  if (bytes.length > MAX_AUDIO_BYTES) return { ok: false, reason: "too_large" };

  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: mimeType || "audio/ogg" }), `audio.${extensionFor(mimeType || "")}`);
  form.set("model", deps.model ?? process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1");
  form.set("language", "pt");
  form.set("response_format", "json");
  form.set("prompt", PROMPT);
  try {
    const res = await (deps.fetch ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "failed" };
    const json = (await res.json()) as { text?: unknown };
    const text = typeof json.text === "string" ? json.text.trim() : "";
    return text && !isPhantomText(text) ? { ok: true, text: text.slice(0, 1500) } : { ok: false, reason: "empty" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
