"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Database } from "@fleet/supabase-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/formatDateTime";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { markAllNotificationsRead, markNotificationRead } from "./notificationActions";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

// Self-contained: reads notifications directly with the browser Supabase client (RLS —
// "members read own notifications" in 0008_notifications.sql — already scopes every
// query to the signed-in user, so no server round trip is needed just to render the
// list), and calls the two server actions in notificationActions.ts only for the
// read-marking mutations.
//
// Freshness strategy: fetch on mount, refetch whenever the panel is opened (so the
// count is never stale when the user actually looks), and poll every 45s in the
// background so the badge itself stays reasonably current while the dropdown is
// closed. A realtime subscription would keep this perfectly in sync, but for a handful
// of notifications a user reads within a dashboard session, 45s polling is simpler to
// reason about and plenty fast — not worth the extra channel/subscription lifecycle
// for this scope.
const POLL_INTERVAL_MS = 45_000;
const LIST_LIMIT = 20;

/** Minimal `{count}` interpolation — no i18n runtime, no date library. */
function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

/**
 * In-app notification rows are written in pt-BR by SECURITY DEFINER RPCs in
 * supabase/migrations (0008/0010/0015/0017/0018/0020/0021) and stored that way — the RPC
 * has no idea which locale the eventual reader uses. Unlike outbound email (sent async to
 * an arbitrary recipient), the person reading this bell IS the current viewer, so the
 * render layer can translate. Titles are a closed set and map exactly; bodies are either
 * fixed literals or a fixed frame around runtime data (a destination or a free-text
 * reason), which is matched below and re-inserted verbatim. Anything unrecognized — a
 * title added to SQL later, an older row — falls through to the raw pt-BR string rather
 * than disappearing.
 */
function translateTitle(t: Dictionary["notifications"], title: string): string {
  return (t.knownTitles as Record<string, string>)[title] ?? title;
}

const BODY_NEW_RESERVATION_PREFIX = "Uma nova viagem para ";
const BODY_NEW_RESERVATION_SUFFIX = " aguarda aprovação.";
const BODY_BLOCK_REASON_PREFIX = "Motivo: ";
const BODY_CANCEL_REASON_PREFIX = "Sua reserva foi cancelada: ";
// Written by lib/domain/autoReassignment.ts, not by an RPC.
const BODY_REASSIGNED_PREFIX =
  "Devido a um atraso na reserva anterior, sua viagem foi movida automaticamente para o veículo ";
const BODY_REASSIGNED_SUFFIX = ".";
// Written by 0020_carpool_host_acceptance.sql / 0021_carpool_response_audit_log.sql.
const BODY_CARPOOL_REQUEST_PREFIX = "Alguém pediu para participar da sua viagem para ";
const BODY_CARPOOL_REQUEST_SUFFIX = ". Acesse os detalhes da reserva para aceitar ou recusar.";
const BODY_CARPOOL_RESPONSE_PREFIX = "Sua solicitação de carona para ";
const BODY_CARPOOL_ACCEPTED_SUFFIX = " foi aceita pelo motorista.";
const BODY_CARPOOL_REJECTED_SUFFIX = " foi recusada pelo motorista.";

function translateBody(t: Dictionary["notifications"], body: string): string {
  const exact = (t.knownBodies as Record<string, string>)[body];
  if (exact) return exact;

  if (body.startsWith(BODY_NEW_RESERVATION_PREFIX) && body.endsWith(BODY_NEW_RESERVATION_SUFFIX)) {
    const destination = body.slice(
      BODY_NEW_RESERVATION_PREFIX.length,
      body.length - BODY_NEW_RESERVATION_SUFFIX.length,
    );
    return t.bodyTemplates.newReservationAwaitingApproval.replace("{destination}", destination);
  }
  if (body.startsWith(BODY_REASSIGNED_PREFIX) && body.endsWith(BODY_REASSIGNED_SUFFIX)) {
    const plate = body.slice(
      BODY_REASSIGNED_PREFIX.length,
      body.length - BODY_REASSIGNED_SUFFIX.length,
    );
    return t.bodyTemplates.autoReassignedToVehicle.replace("{plate}", plate);
  }
  if (body.startsWith(BODY_CANCEL_REASON_PREFIX)) {
    return t.bodyTemplates.reservationCancelledReason.replace(
      "{reason}",
      body.slice(BODY_CANCEL_REASON_PREFIX.length),
    );
  }
  if (body.startsWith(BODY_BLOCK_REASON_PREFIX)) {
    return t.bodyTemplates.vehicleBlockedReason.replace(
      "{reason}",
      body.slice(BODY_BLOCK_REASON_PREFIX.length),
    );
  }
  if (body.startsWith(BODY_CARPOOL_REQUEST_PREFIX) && body.endsWith(BODY_CARPOOL_REQUEST_SUFFIX)) {
    const destination = body.slice(
      BODY_CARPOOL_REQUEST_PREFIX.length,
      body.length - BODY_CARPOOL_REQUEST_SUFFIX.length,
    );
    return t.bodyTemplates.carpoolRequestReceived.replace("{destination}", destination);
  }
  if (body.startsWith(BODY_CARPOOL_RESPONSE_PREFIX) && body.endsWith(BODY_CARPOOL_ACCEPTED_SUFFIX)) {
    const destination = body.slice(
      BODY_CARPOOL_RESPONSE_PREFIX.length,
      body.length - BODY_CARPOOL_ACCEPTED_SUFFIX.length,
    );
    return t.bodyTemplates.carpoolAccepted.replace("{destination}", destination);
  }
  if (body.startsWith(BODY_CARPOOL_RESPONSE_PREFIX) && body.endsWith(BODY_CARPOOL_REJECTED_SUFFIX)) {
    const destination = body.slice(
      BODY_CARPOOL_RESPONSE_PREFIX.length,
      body.length - BODY_CARPOOL_REJECTED_SUFFIX.length,
    );
    return t.bodyTemplates.carpoolRejected.replace("{destination}", destination);
  }

  return body;
}

function formatRelativeTime(iso: string, locale: Locale, relative: Dictionary["notifications"]["relative"]): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return relative.now;
  if (diffMin < 60) return withCount(relative.minutes, diffMin);
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return withCount(relative.hours, diffHours);
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return withCount(relative.days, diffDays);
  return formatDate(iso, locale);
}

export function NotificationBell({
  align = "right",
  dict,
  locale,
}: {
  align?: "left" | "right";
  dict: Dictionary;
  locale: Locale;
}) {
  const t = dict.notifications;
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [{ data: list, error: listError }, { count, error: countError }] = await Promise.all([
      supabase
        .from("notifications")
        .select("id,organization_id,user_id,title,body,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);

    if (listError || countError) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setNotifications(list ?? []);
    setUnreadCount(count ?? 0);
  }, [supabase]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function handleMarkOne(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await markNotificationRead(id);
    } catch {
      refresh();
    }
  }

  async function handleMarkAll() {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      refresh();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={unreadCount > 0 ? withCount(t.ariaUnread, unreadCount) : t.label}
        className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-line-800 text-fog-400 hover:border-gwm-accent hover:text-gwm-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gwm-accent"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-red px-1 font-mono text-[10px] font-semibold leading-none text-paper-50">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          role="region"
          aria-label={t.label}
          className={`absolute top-[calc(100%+8px)] z-50 flex w-80 flex-col rounded-md border border-line-800 bg-panel-900 shadow-lg shadow-black/40 ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line-800 px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-fog-400">{t.label}</h3>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-teal"
              >
                {t.markAllRead}
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loadError ? (
              <p className="px-4 py-6 text-center text-sm text-signal-red">
                {t.loadError}
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fog-400">{t.empty}</p>
            ) : (
              <ul>
                {notifications.map((n) => {
                  const isUnread = n.read_at === null;
                  return (
                    <li key={n.id} className="border-b border-line-800 last:border-0">
                      <button
                        type="button"
                        onClick={() => (isUnread ? handleMarkOne(n.id) : undefined)}
                        className={`flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-panel-800 ${
                          isUnread ? "cursor-pointer" : "cursor-default"
                        }`}
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            isUnread ? "bg-gwm-accent" : "bg-transparent"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className={`text-sm ${isUnread ? "text-paper-50" : "text-fog-400"}`}>
                            {translateTitle(t, n.title)}
                          </span>
                          <span className="text-xs text-fog-400">{translateBody(t, n.body)}</span>
                          <span className="font-mono text-xs text-fog-600">
                            {formatRelativeTime(n.created_at, locale, t.relative)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
