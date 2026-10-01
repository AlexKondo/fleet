/**
 * C7b: free-text length caps applied server-side to trip text that comes from a form or from the LLM (hostile or
 * just huge input must not bloat the DB, notification bodies or pages). The caps are far above any real address /
 * justification; rendering is always React text (escaped), these only bound the size.
 */
export const MAX_LOCATION_TEXT = 300;
export const MAX_JUSTIFICATION_TEXT = 500;

export const clampText = (value: unknown, max: number): string => (typeof value === "string" ? value : String(value ?? "")).slice(0, max);
