import { describe, expect, it, vi } from "vitest";
import { isPhantomText, MAX_AUDIO_BYTES, transcribeAudio } from "./transcribe";

const OK = Buffer.from("fake-opus-bytes").toString("base64");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("transcribeAudio (OpenAI)", () => {
  it("is off without a key and never calls the network", async () => {
    const f = vi.fn();
    expect(await transcribeAudio(OK, "audio/ogg", { apiKey: "", fetch: f as unknown as typeof fetch })).toEqual({ ok: false, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
  it("sends the audio as a file with model, Portuguese and the key as a bearer; returns the trimmed text", async () => {
    const f = vi.fn(async () => json({ text: "  quero um carro amanhã  " }));
    const r = await transcribeAudio(OK, "audio/ogg; codecs=opus", { apiKey: "sk-test", fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, text: "quero um carro amanhã" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("pt");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.ogg");
    expect(file.size).toBe(Buffer.from(OK, "base64").length);
  });
  it("accepts a data URL and picks the extension from the mime type", async () => {
    const f = vi.fn(async () => json({ text: "ok" }));
    await transcribeAudio(`data:audio/mp4;base64,${OK}`, "audio/mp4", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get("file")).toHaveProperty("name", "audio.m4a");
  });
  it("refuses invalid or oversized audio before any network call", async () => {
    const f = vi.fn();
    const deps = { apiKey: "k", fetch: f as unknown as typeof fetch };
    for (const bad of ["", "not base64 !!!", "====", null as unknown as string]) expect((await transcribeAudio(bad, "audio/ogg", deps)).ok).toBe(false);
    const big = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString("base64");
    expect(await transcribeAudio(big, "audio/ogg", deps)).toEqual({ ok: false, reason: "too_large" });
    expect(f).not.toHaveBeenCalled();
  });
  it("a provider error, a network failure and an empty transcript are reported, never thrown", async () => {
    expect(await transcribeAudio(OK, "audio/ogg", { apiKey: "k", fetch: (async () => json({}, 500)) as unknown as typeof fetch })).toEqual({ ok: false, reason: "failed" });
    expect(await transcribeAudio(OK, "audio/ogg", { apiKey: "k", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: "failed" });
    expect(await transcribeAudio(OK, "audio/ogg", { apiKey: "k", fetch: (async () => json({ text: "   " })) as unknown as typeof fetch })).toEqual({ ok: false, reason: "empty" });
  });
});

describe("phantom transcripts", () => {
  it("subtitle credits and sign-offs Whisper invents in silence are not requests", async () => {
    for (const text of ["Legendas pela comunidade Amara.org", "Legendado por Fulano", "Obrigado.", "Obrigado por assistir!", "Tchau, tchau", "...", " "]) expect(isPhantomText(text), text).toBe(true);
    for (const text of ["Quero um carro amanhã às 8h", "Tem carona para Campinas?", "Obrigado, pode confirmar a reserva das nove horas para Campinas"]) expect(isPhantomText(text), text).toBe(false);
    const f = async () => json({ text: "Legendas pela comunidade Amara.org" });
    expect(await transcribeAudio(OK, "audio/ogg", { apiKey: "k", fetch: f as unknown as typeof fetch })).toEqual({ ok: false, reason: "empty" });
  });
});
