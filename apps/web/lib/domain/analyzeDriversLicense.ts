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

const SYSTEM_PROMPT = `You read Brazilian driver's licenses (CNH - Carteira Nacional de Habilitação) from a photo.
Extract exactly these fields: the license number ("Nº Registro" / "Nº de Registro"), the driver's full name, the category (categoria — e.g. A, B, AB, C, D, E), and the expiration date ("Validade").
Respond with ONLY a JSON object, no other text:
- If you can clearly read all four fields: {"readable": true, "number": "...", "fullName": "...", "category": "...", "expirationDate": "YYYY-MM-DD"}
- If the image isn't a CNH, is too blurry/dark/cropped to read reliably, or is missing a required field: {"readable": false}
Never guess a value you can't actually read — return readable:false instead.`;

/**
 * Sends the CNH photo to a vision-capable LLM and asks it to extract exactly the fields
 * the driver-authorization flow needs (0014_driver_authorization.sql's
 * drivers_license_number/category/expiration). Deliberately conservative: the model is
 * instructed to say "unreadable" rather than guess, because a wrong expiration date here
 * would silently auto-authorize a driver whose real license may already be expired —
 * BR-004/GT-011 needs the printed date, not the model's best guess at it.
 */
export async function analyzeDriversLicense(photo: File): Promise<AnalyzeLicenseResult> {
  const apiKey = process.env.API_OPENAI;
  if (!apiKey) {
    return { status: "error", message: "missing_api_key" };
  }

  const bytes = Buffer.from(await photo.arrayBuffer());
  const base64 = bytes.toString("base64");
  const mimeType = photo.type || "image/jpeg";

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { status: "error", message: "unexpected_openai_response" };
    }

    const parsed = JSON.parse(content) as {
      readable?: boolean;
      number?: string;
      fullName?: string;
      category?: string;
      expirationDate?: string;
    };

    if (
      !parsed.readable ||
      !parsed.number ||
      !parsed.fullName ||
      !parsed.category ||
      !parsed.expirationDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.expirationDate)
    ) {
      return { status: "unreadable" };
    }

    return {
      status: "ok",
      data: {
        number: parsed.number,
        fullName: parsed.fullName,
        category: parsed.category,
        expirationDate: parsed.expirationDate,
      },
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "unknown_error" };
  }
}
