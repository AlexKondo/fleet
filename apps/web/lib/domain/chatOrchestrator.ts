import "server-only";
import { INTENT_NAMES, isIntentKnown, missingRequiredSlots, type IntentName } from "@fleet/domain";

export type InterpretResult =
  | { status: "ok"; intent: IntentName; slots: Record<string, string>; summary: string }
  | { status: "needs_clarification"; question: string }
  | { status: "low_confidence" }
  | { status: "unknown_intent" }
  | { status: "error"; message: string };

const SYSTEM_PROMPT_TEMPLATE = `You are the conversational assistant inside "Fleet", a corporate vehicle fleet management app. A user is typing or speaking a request in natural language (in ${"{{LOCALE_NAME}}"}) instead of filling out a form. Your ONLY job is to classify their message into one of a fixed set of intents and extract structured slot values — you never decide whether a reservation is actually allowed, never invent vehicle availability, and never perform any action yourself.

Intent catalog (respond with exactly one of these names, or "UNKNOWN" if none fit):
- CREATE_RESERVATION — book a vehicle for a trip. Slots: departureAt, expectedReturnAt (ISO 8601 datetimes, resolved from relative phrases like "amanhã às 8h" using the current date/time given below), destination, origin (optional), passengerCount (optional, default 1), requiresCargo (optional boolean).
- VIEW_RESERVATION — check an existing reservation's details. Slots: reservationId (optional — if absent, means "my current/next trip").
- CHANGE_RESERVATION — modify an existing reservation. Slots: reservationId.
- EXTEND_RESERVATION — push back the return time of an active trip. Slots: reservationId (optional if only one is active), newExpectedReturnAt.
- CANCEL_RESERVATION — cancel a reservation. Slots: reservationId (optional if only one is active/upcoming).
- FIND_MY_VEHICLE — where is my currently assigned/reserved vehicle. Slots: none.
- CHECK_AVAILABILITY — is a vehicle available for a given window, without booking. Slots: departureAt, expectedReturnAt.
- CHECK_RANGE — will a vehicle's range/autonomy suffice for a destination. Slots: destination.
- REQUEST_DIFFERENT_VEHICLE — ask for an alternative to the currently assigned/recommended vehicle. Slots: reservationId (optional).
- REPORT_DAMAGE — report vehicle damage. Slots: reservationId (optional if only one is active), damageNotes.
- REPORT_DELAY — report that the trip will return later than planned. Slots: reservationId (optional if only one is active).
- START_TRIP — record vehicle pickup for an active reservation. Slots: reservationId (optional if only one is active).
- END_TRIP — record vehicle return for an active reservation. Slots: reservationId (optional if only one is active).
- ASK_FLEET — a general question about the fleet/policies that doesn't map to any action above. Slots: none.

Ground rules:
- Never guess a slot value you cannot actually infer from the message or the given context — omit it instead.
- If required information for an otherwise-clear intent is missing, respond with "needs_clarification" and ONE focused follow-up question (never ask for more than what's actually missing).
- If the message is ambiguous or you're not confident which intent applies, respond with "low_confidence" rather than guessing.
- "summary" must be a short, plain-language, first-person-plural confirmation sentence in ${"{{LOCALE_NAME}}"} describing exactly what will happen (e.g. "Vou reservar um carro para amanhã às 8h, retorno às 17h, destino São Paulo.") — this is shown to the user before anything is executed, so it must be accurate and complete.
- Respond with ONLY a JSON object, no other text, no markdown code fence:
  {"status": "ok", "intent": "<name>", "slots": {...}, "summary": "..."}
  {"status": "needs_clarification", "question": "..."}
  {"status": "low_confidence"}
  {"status": "unknown_intent"}`;

const LOCALE_NAMES: Record<string, string> = {
  "pt-BR": "Portuguese (Brazil)",
  "en-US": "English",
  es: "Spanish",
  "zh-CN": "Chinese",
};

function parseModelJson(content: string): InterpretResult {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  let parsed: {
    status?: string;
    intent?: string;
    slots?: Record<string, string>;
    summary?: string;
    question?: string;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { status: "error", message: "unparseable_response" };
  }

  if (parsed.status === "needs_clarification" && parsed.question) {
    return { status: "needs_clarification", question: parsed.question };
  }
  if (parsed.status === "low_confidence") return { status: "low_confidence" };
  if (parsed.status === "unknown_intent") return { status: "unknown_intent" };
  if (parsed.status === "ok" && parsed.intent && isIntentKnown(parsed.intent) && parsed.summary) {
    return { status: "ok", intent: parsed.intent, slots: parsed.slots ?? {}, summary: parsed.summary };
  }
  return { status: "error", message: "unexpected_response_shape" };
}

/**
 * Interprets one conversational turn: classifies the message into one of the catalog
 * intents (packages/domain/src/chat/intentCatalog.ts) and extracts whatever slots it can.
 * This function NEVER executes anything — it only returns an interpretation for
 * apps/web/app/chat/actions.ts to act on, and only after the user explicitly confirms.
 * Same pattern as analyzeDriversLicense.ts (this app's only other LLM integration):
 * server-only, raw fetch to Claude, no `temperature` (this model rejects it), strict
 * JSON-only contract, defensive parsing, never throws.
 */
export async function interpretMessage(input: {
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  locale: string;
  context: {
    today: string;
    organizationName: string;
    activeReservationIds: string[];
  };
}): Promise<InterpretResult> {
  const apiKey = process.env.API_CLAUDE;
  if (!apiKey) return { status: "error", message: "missing_api_key" };

  const localeName = LOCALE_NAMES[input.locale] ?? "Portuguese (Brazil)";
  const systemPrompt =
    SYSTEM_PROMPT_TEMPLATE.replaceAll("{{LOCALE_NAME}}", localeName) +
    `\n\nContext: today is ${input.context.today}. Organization: ${input.context.organizationName}. The user's active/upcoming reservation ids: ${
      input.context.activeReservationIds.length > 0 ? input.context.activeReservationIds.join(", ") : "none"
    }.`;

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
        system: systemPrompt,
        messages: [
          ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
          { role: "user", content: input.message },
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

export { INTENT_NAMES, missingRequiredSlots };
export type { IntentName };
