import "server-only";

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
Respond with ONLY a JSON object, no other text:
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
  try {
    parsed = JSON.parse(content);
  } catch {
    return { status: "unreadable" };
  }

  if (
    !parsed.readable ||
    !parsed.number ||
    !parsed.fullName ||
    !parsed.category ||
    !parsed.expirationDate ||
    !ISO_DATE.test(parsed.expirationDate)
  ) {
    return { status: "unreadable" };
  }

  let expirationDate = parsed.expirationDate;

  // Ground-truth check independent of the prompt actually being followed: Validade is
  // structurally always after Emissão on a real CNH. If the model still swapped the two
  // adjacent fields (the exact failure mode a real user hit — see the prompt's own note
  // above), issueDate ends up later than expirationDate, which is physically impossible.
  // Swapping them back here fixes the common case without needing readable:false and
  // asking the user to re-upload for what's ultimately our own extraction ordering, not a
  // genuinely unreadable document.
  if (parsed.issueDate && ISO_DATE.test(parsed.issueDate) && parsed.issueDate >= expirationDate) {
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
 * CNH Digital (the official app) exports as a PDF, not a photo — a real user upload we
 * hit in testing. Chat Completions' `image_url` content type only accepts raster images,
 * so a PDF has to go through the Responses API's `input_file` content type instead,
 * which OpenAI rasterizes internally before the vision model sees it.
 */
export async function analyzeDriversLicense(photo: File): Promise<AnalyzeLicenseResult> {
  const apiKey = process.env.API_OPENAI;
  if (!apiKey) {
    return { status: "error", message: "missing_api_key" };
  }

  const bytes = Buffer.from(await photo.arrayBuffer());
  const base64 = bytes.toString("base64");
  const mimeType = photo.type || "image/jpeg";
  const isPdf = mimeType === "application/pdf";

  try {
    const response = isPdf
      ? await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            text: { format: { type: "json_object" } },
            temperature: 0,
            input: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "input_text", text: "Read this CNH document and extract the fields." },
                  {
                    type: "input_file",
                    filename: photo.name || "cnh.pdf",
                    file_data: `data:${mimeType};base64,${base64}`,
                  },
                ],
              },
            ],
          }),
        })
      : await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            temperature: 0,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: "Read this CNH photo and extract the fields." },
                  { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                ],
              },
            ],
          }),
        });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { status: "error", message: `openai_http_${response.status}: ${body.slice(0, 200)}` };
    }

    const json = await response.json();
    // Responses API and Chat Completions shape their reply differently.
    const content: unknown = isPdf
      ? (json.output ?? [])
          .flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
          .find((c: { type: string; text?: string }) => c.type === "output_text")?.text
      : json.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      return { status: "error", message: "unexpected_openai_response" };
    }

    return parseModelJson(content);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "unknown_error" };
  }
}
