/**
 * The side menu has ONE layout and ONE default width; each person can drag it wider or narrower. The chosen width is kept in a cookie named after the
 * user (so another person on the same browser keeps their own) and is read on the server, so the page is drawn at that width from the first paint.
 */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 380;
export const SIDEBAR_DEFAULT = 240;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));
}

/** A stored value (cookie) as a safe width; anything unreadable is the default. */
export function parseSidebarWidth(raw: string | null | undefined): number {
  if (!raw || !/^\d{3}$/.test(raw.trim())) return SIDEBAR_DEFAULT;
  return clampSidebarWidth(Number(raw));
}

/** One cookie per user id (only the characters of a uuid are kept). */
export function sidebarCookieName(userId: string | null | undefined): string {
  const id = String(userId ?? "").replace(/[^0-9a-zA-Z-]/g, "").slice(0, 40);
  return `fm_sidebar_w_${id || "anon"}`;
}
