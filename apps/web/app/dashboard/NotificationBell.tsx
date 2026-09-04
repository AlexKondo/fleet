"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Database } from "@fleet/supabase-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `há ${diffDays} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function NotificationBell({ align = "right" }: { align?: "left" | "right" }) {
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
        aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
        className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-line-800 text-fog-400 hover:border-signal-amber hover:text-signal-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber"
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
          aria-label="Notificações"
          className={`absolute top-[calc(100%+8px)] z-50 flex w-80 flex-col rounded-md border border-line-800 bg-panel-900 shadow-lg shadow-black/40 ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line-800 px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-fog-400">Notificações</h3>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-teal"
              >
                Marcar todas como lidas
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loadError ? (
              <p className="px-4 py-6 text-center text-sm text-signal-red">
                Não foi possível carregar as notificações agora.
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fog-400">Nenhuma notificação por aqui.</p>
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
                            isUnread ? "bg-signal-amber" : "bg-transparent"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className={`text-sm ${isUnread ? "text-paper-50" : "text-fog-400"}`}>
                            {n.title}
                          </span>
                          <span className="text-xs text-fog-400">{n.body}</span>
                          <span className="font-mono text-xs text-fog-600">
                            {formatRelativeTime(n.created_at)}
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
