import "server-only";
import { renderPdfFirstPageToPng } from "./renderPdfPageToPng";

export interface DriversLicenseData {
  number: string;
  fullName: string;
  category: string;
  /** ISO yyyy-mm-dd. */
  expirationDate: string;
}

export type AnalyzeLicenseResult =
  | { status: "ok"; data: DriversLicenseData }
  | { status: "unreadable" }
  | { status: "error"; message: string };

const SYSTEM_PROMPT = `You read Brazilian driver's licenses (CNH - Carteira Nacional de Habilitação), either a photo of the physical card or a CNH Digital PDF (the official app's export).

Every CNH (physical or digital) follows the same official layout with numbered fields.
The two fields you must NOT confuse sit RIGHT NEXT TO EACH OTHER, in this exact order, left to right, same row:
  Field "4a" = "DATA EMISSÃO" (issue date) — NOT what you want.
  Field "4b" = "VALIDADE" (expiration date) — THIS is expirationDate. It is immediately to the RIGHT of 4a/Emissão, and it is a SMALL RED/colored numeral block on most cards and PDFs.
Also present elsewhere, also NOT what you want: "3 Data de Nascimento" (birth date, top area) and "1ª Habilitação" (top right, often decades old).

Ground truth rule, use it as a check even if you read the labels: Validade (4b) is ALWAYS chronologically LATER than Emissão (4a) — typically 5 to 10 years later. If the two dates you found in that emissão/validade pair are close together or the "later" one looks like the one on the LEFT, you almost certainly swapped them — re-examine and take the field positioned on the RIGHT (4b) as expirationDate, not the one on the left (4a).

If you are not confident which one is 4b/Validade specifically, return readable:false rather than guessing — do not default to whichever date you noticed first.

Extract exactly these fields: the license number ("5 Nº Registro"), the driver's full name ("1/2 Nome"), the category ("9 Cat Hab" — e.g. A, B, AB, C, D, E), the expiration date (field 4b, as defined above), AND the issue date (field 4a) — the issue date is returned too, purely so the caller can sanity-check that 4b is after 4a.
Respond with ONLY a JSON object, no other text, no markdown code fence:
- If you can clearly read all five fields: {"readable": true, "number": "...", "fullName": "...", "category": "...", "issueDate": "YYYY-MM-DD", "expirationDate": "YYYY-MM-DD"}
- If the document isn't a CNH, is too blurry/dark/cropped to read reliably, or is missing a required field: {"readable": false}
Never guess a value you can't actually read — return readable:false instead.`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseModelJson(content: string):
  | { status: "ok"; data: DriversLicenseData }
  | { status: "unreadable" } {
  let parsed: {
    readable?: boolean;
    number?: string;
    fullName?: string;
    category?: string;
    issueDate?: string;
    expirationDate?: string;
  };
  // Claude sometimes wraps JSON in a ```json fence despite being told not to — strip it
  // before parsing rather than rejecting an otherwise well-formed reading.
  const cleaned = content.trim().replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { status: "unreadable" };
  }

  if (
    !parsed.readable ||
    !parsed.number ||
    !parsed.fullName ||
    !parsed.category ||
    !parsed.expirationDate ||
    !ISO_DATE.test(parsed.expirationDate) ||
    // issueDate is REQUIRED, not just requested — a response missing it skips the
    // swap-correction below entirely, which is exactly how an earlier version of this
    // check silently let a mixed-up date through (the model ignored the prompt's request
    // for issueDate, so `parsed.issueDate` was undefined and the check below never ran).
    !parsed.issueDate ||
    !ISO_DATE.test(parsed.issueDate)
  ) {
    return { status: "unreadable" };
  }

  let expirationDate = parsed.expirationDate;

  // Ground-truth check independent of the prompt actually being followed: Validade is
  // structurally always after Emissão on a real CNH. If the model swapped the two
  // adjacent fields, issueDate ends up later than expirationDate, which is physically
  // impossible — swap them back rather than reject a document that was, in substance,
  // fully read correctly.
  if (parsed.issueDate >= expirationDate) {
    expirationDate = parsed.issueDate;
  }

  return {
    status: "ok",
    data: {
      number: parsed.number,
      fullName: parsed.fullName,
      category: parsed.category,
      expirationDate,
    },
  };
}

/**
 * Sends the CNH photo/PDF to a vision-capable LLM and asks it to extract exactly the
 * fields the driver-authorization flow needs (0014_driver_authorization.sql's
 * drivers_license_number/category/expiration). Deliberately conservative: the model is
 * instructed to say "unreadable" rather than guess, because a wrong expiration date here
 * would silently auto-authorize a driver whose real license may already be expired —
 * BR-004/GT-011 needs the printed date, not the model's best guess at it.
 *
 * Runs on Claude (Anthropic Messages API), not OpenAI — OpenAI (gpt-4o-mini, then
 * gpt-4o) repeatedly misread the small printed 4a/4b date fields in testing even after
 * rendering PDFs to a fixed high-resolution PNG ourselves, so the model itself (not just
 * the image pipeline) was switched.
 *
 * A PDF (CNH Digital's export format) is sent to Claude directly first — Claude has
 * native PDF input support, and unlike OpenAI (whose internal PDF rasterization had no
 * exposed resolution control and was the likely cause of repeated misreads on a real
 * PDF), that's untested territory worth trying plain, since the equivalent photo path
 * already reads correctly. Only if that first attempt comes back unreadable/erroring do
 * we fall back to the same fixed-resolution local render (renderPdfPageToPng.ts) used
 * before, sent as a regular image — the more complex path, kept as a safety net rather
 * than the default.
 */
export async function analyzeDriversLicense(photo: File): Promise<AnalyzeLicenseResult> {
  const apiKey = process.env.API_CLAUDE;
  if (!apiKey) {
    return { status: "error", message: "missing_api_key" };
  }

  if (photo.type === "application/pdf") {
    const pdfBytes = new Uint8Array(await photo.arrayBuffer());

    const direct = await callClaude(apiKey, {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdfBytes).toString("base64") },
    });
    if (direct.status === "ok") return direct;

    try {
      const png = await renderPdfFirstPageToPng(pdfBytes);
      return callClaude(apiKey, {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
      });
    } catch (err) {
      console.error("analyzeDriversLicense: local PDF render fallback failed too:", err);
      return direct;
    }
  }

  const base64 = Buffer.from(await photo.arrayBuffer()).toString("base64");
  const mimeType = photo.type || "image/jpeg";
  return callClaude(apiKey, {
    type: "image",
    source: { type: "base64", media_type: mimeType, data: base64 },
  });
}

async function callClaude(
  apiKey: string,
  contentBlock:
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "document"; source: { type: "base64"; media_type: string; data: string } },
): Promise<AnalyzeLicenseResult> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 500,
        // No `temperature` here — this model rejects it outright (400: "temperature is
        // deprecated for this model"), which was silently failing every single reading
        // before this was caught in the runtime logs.
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Read this CNH document and extract the fields." },
              contentBlock,
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { status: "error", message: `claude_http_${response.status}: ${body.slice(0, 200)}` };
    }

    const json = await response.json();
    const content: unknown = json.content?.find(
      (block: { type: string; text?: string }) => block.type === "text",
    )?.text;

    if (typeof content !== "string") {
      return { status: "error", message: "unexpected_claude_response" };
    }

    return parseModelJson(content);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "unknown_error" };
  }
}
