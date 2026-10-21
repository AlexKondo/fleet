import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import dict from "@/lib/i18n/dictionaries/pt-BR";
import type { ChecklistState } from "@/lib/operations/checklistState";
import Page from "./page";
import { FmShell } from "../../carpool/FmShell";

/**
 * FIX-VISUAL: /reservations/[id] renders inside the FleetMind shell for EVERY role (before, only employees did; the
 * other roles fell through to the legacy AppShell — black sidebar, "VIAGEM" header). The role-specific blocks must be
 * present/absent under exactly the same conditions as the legacy branch:
 *   - access: privileged (fleet_manager/administrator/security) or own reservation, else redirect /trips
 *   - pickup/return links: checklist state can_pickup/can_return
 *   - cancel: own reservation + pending_approval, or confirmed with the vehicle not in_use/returning
 *   - impacted notice: any viewer; the "reassign on the dashboard" hint only for privileged roles
 *   - pending carpool join requests (accept/decline): own reservation only
 *   - message thread: every viewer
 *   - evidence links ("Fotos da retirada/devolução"): only the employee branch had them (kept as-is)
 */
const s = vi.hoisted(() => ({
  role: "employee",
  userId: "user-owner",
  requesterId: "user-owner",
  status: "confirmed",
  vehicleStatus: "available",
  impacted: false,
  checklist: null as unknown,
  pending: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/reservations/res-1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/currentUser", () => ({
  getCurrentUser: async () => ({ id: s.userId, email: "fixture@example.invalid" }),
}));

function rows(table: string): unknown {
  if (table === "profiles")
    return {
      full_name: "Pessoa de teste",
      role: s.role,
      organization_id: "org-1",
      organization: { name: "Organização de teste" },
    };
  if (table === "reservations")
    return {
      id: "res-1",
      status: s.status,
      start_at: "2026-10-22T12:00:00Z",
      end_at: "2026-10-22T18:00:00Z",
      impacted_at: s.impacted ? "2026-10-21T10:00:00Z" : null,
      impacted_reason: s.impacted ? "Atraso na devolução anterior" : null,
      vehicle: {
        plate: "TST1A23",
        name: "Veículo de teste",
        status: s.vehicleStatus,
        category: { name: "SUV", passenger_capacity: 5 },
      },
      trip_request: {
        id: "trip-1",
        origin: "Origem de teste",
        destination: "Destino de teste",
        requester_id: s.requesterId,
        justification: null,
        passenger_count: 1,
        departure_at: "2099-10-22T12:00:00Z",
        requester: { full_name: "Solicitante de teste" },
      },
    };
  if (table === "reservation_messages") return [];
  if (table === "trip_participants") return s.pending;
  return null;
}
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "limit"]) b[m] = () => b;
  b.single = async () => ({ data: rows(table), error: null });
  b.maybeSingle = b.single;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(table), error: null }).then(ok);
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/lib/operations/checklistState", () => ({ loadChecklistState: async () => s.checklist }));
vi.mock("./loadHostCarpool", () => ({ loadHostCarpool: async () => null }));
vi.mock("@/lib/i18n/getLocale", () => ({ getDictionary: async () => dict, getLocale: async () => "pt-BR" }));
vi.mock("./actions", () => ({ respondToCarpoolRequest: async () => {} }));
vi.mock("../../trips/actions", () => ({ cancelMyReservation: async () => {} }));
vi.mock("./MessageThread", () => ({
  MessageThread: () => React.createElement("div", { "data-testid": "message-thread" }),
}));
vi.mock("../../carpool/RouteMapCard", () => ({
  RouteMapCard: () => React.createElement("div", { "data-testid": "route-map" }),
}));
vi.mock("../../ConfirmSubmitButton", () => ({
  ConfirmSubmitButton: ({ confirmMessage, className, children }: { confirmMessage: string; className?: string; children: React.ReactNode }) =>
    React.createElement("button", { type: "submit", "data-confirm": confirmMessage, className }, children),
}));
vi.mock("@/app/shellData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/shellData")>();
  return {
    ...actual,
    loadShellContext: async () => ({
      locale: "pt-BR",
      dict,
      roleLabels: {},
      licenseMissing: false,
      avatarUrl: null,
      licenseGateActive: false,
      chatInitialState: { status: "idle", messages: [] },
      canKeyCustody: false,
      canBudgetApproval: false,
    }),
  };
});
vi.mock("@/app/ChatWidget", () => ({ ChatWidget: () => null, OPEN_CHAT_EVENT: "fleet-test-chat" }));
vi.mock("@/app/dashboard/actions", () => ({ signOut: async () => {} }));

const state = (over: Partial<ChecklistState> = {}): ChecklistState => ({
  pickup_traveler: false,
  pickup_security: false,
  return_traveler: false,
  return_security: false,
  departed: false,
  arrived: false,
  own_pickup: false,
  own_return: false,
  legacy_pickup: false,
  can_pickup: false,
  can_return: false,
  inspection_role: null,
  own_pickup_id: null,
  own_return_id: null,
  ...over,
});

type ShellProps = Parameters<typeof FmShell>[0];
async function load() {
  const el = (await Page({ params: Promise.resolve({ id: "res-1" }), searchParams: Promise.resolve({}) })) as ReactElement<ShellProps>;
  return el;
}
async function render() {
  const el = await load();
  expect(el.type).toBe(FmShell);
  return { props: el.props, html: renderToStaticMarkup(await FmShell(el.props)) };
}

beforeEach(() => {
  s.role = "employee";
  s.userId = "user-owner";
  s.requesterId = "user-owner";
  s.status = "confirmed";
  s.vehicleStatus = "available";
  s.impacted = false;
  s.checklist = null;
  s.pending = [];
});

const ROLES = ["employee", "fleet_manager", "administrator", "security", "maintenance_operator"] as const;
const PRIVILEGED = new Set(["fleet_manager", "administrator", "security"]);
const reassignLink = `<a[^>]*href="/dashboard"[^>]*>${dict.reservations.detail.impactedReassignLink}</a>`;
const cancelBtn = `data-confirm="${dict.trips.list.confirmCancel}"`;
const declineBtn = `data-confirm="${dict.reservations.detail.declineConfirm}"`;

describe("/reservations/[id] renders the FleetMind shell for every role", () => {
  it.each(ROLES)("%s (own reservation): new shell markers, no legacy AppShell markup", async (role) => {
    s.role = role;
    const { props, html } = await render();
    expect(props.role).toBe(role);
    expect(props.active).toBe("trips");
    expect(props.isFleetManager).toBe(role === "fleet_manager" || role === "administrator");
    expect(props.isAdministrator).toBe(role === "administrator");
    expect(html).toContain('data-testid="fm-theme"');
    expect(html).toContain('class="fm-sidebar"');
    expect(html).toContain('class="fm-topbar"');
    expect(html).toContain('data-testid="reservation-detail-fm"');
    expect(html).toContain('aria-current="page" href="/trips"'); // "Minhas viagens" stays the active nav item
    expect(html).not.toContain("md:w-60");
    expect(html).not.toContain("bg-panel-900/40");
    // back link + vehicle header + the shared blocks
    expect(html).toContain(`<a class="fm-link" href="/trips">${dict.reservations.detail.backToTrips}</a>`);
    expect(html).toContain("Veículo de teste");
    expect(html).toContain('data-testid="route-map"');
    expect(html).toContain('data-testid="message-thread"');
    expect(html).toContain(dict.reservations.detail.communicationTitle);
    // own + confirmed + vehicle available -> cancel offered for every role (legacy rule: isOwnReservation)
    expect(html).toContain(cancelBtn);
  });

  it.each(ROLES)("%s viewing someone else's reservation: access and actions follow the legacy rules", async (role) => {
    s.role = role;
    s.requesterId = "someone-else";
    s.impacted = true;
    s.pending = [{ id: "p1", passenger_count: 1, joined_at: "2026-10-20T10:00:00Z", passenger: { full_name: "Carona" } }];
    if (!PRIVILEGED.has(role)) {
      await expect(load()).rejects.toThrow("REDIRECT:/trips");
      return;
    }
    const { html } = await render();
    expect(html).toContain('class="fm-sidebar"');
    expect(html).not.toContain(cancelBtn); // not own
    expect(html).not.toContain(declineBtn); // carpool requests are the host's call only
    expect(html).not.toContain(dict.reservations.detail.carpoolRequestsTitle);
    expect(html).toContain(dict.reservations.detail.impactedTitle);
    expect(html).toMatch(new RegExp(reassignLink)); // privileged-only hint kept
    expect(html).toContain('data-testid="message-thread"');
  });

  it.each(ROLES)("%s own impacted reservation: reassign hint only for privileged roles", async (role) => {
    s.role = role;
    s.impacted = true;
    const { html } = await render();
    expect(html).toContain(dict.reservations.detail.impactedTitle);
    expect(html).toContain("Atraso na devolução anterior");
    if (PRIVILEGED.has(role)) expect(html).toMatch(new RegExp(reassignLink));
    else expect(html).not.toMatch(new RegExp(reassignLink));
  });

  it.each(ROLES)("%s: pickup/return links follow the checklist state", async (role) => {
    s.role = role;
    s.checklist = state({ can_pickup: true });
    let { html } = await render();
    expect(html).toContain('href="/reservations/res-1/pickup"');
    expect(html).not.toContain('href="/reservations/res-1/return"');
    s.checklist = state({ can_return: true });
    ({ html } = await render());
    expect(html).toContain('href="/reservations/res-1/return"');
    expect(html).not.toContain('href="/reservations/res-1/pickup"');
    s.checklist = state();
    ({ html } = await render());
    expect(html).not.toContain("/pickup");
    expect(html).not.toContain("/return");
  });

  it.each(ROLES)("%s: cancel is hidden once the trip is underway or finished", async (role) => {
    s.role = role;
    s.vehicleStatus = "in_use";
    expect((await render()).html).not.toContain(cancelBtn);
    s.vehicleStatus = "available";
    s.status = "completed";
    expect((await render()).html).not.toContain(cancelBtn);
    s.status = "pending_approval";
    expect((await render()).html).toContain(cancelBtn);
  });

  it.each(ROLES)("%s own reservation: pending carpool requests can be accepted/declined", async (role) => {
    s.role = role;
    s.pending = [{ id: "p1", passenger_count: 2, joined_at: "2026-10-20T10:00:00Z", passenger: { full_name: "Carona Teste" } }];
    const { html } = await render();
    expect(html).toContain(dict.reservations.detail.carpoolRequestsTitle);
    expect(html).toContain("Carona Teste");
    expect(html).toContain(dict.reservations.detail.accept);
    expect(html).toContain(declineBtn);
  });

  it.each(ROLES)("%s: evidence links stay exactly as before (employee branch only)", async (role) => {
    s.role = role;
    s.checklist = state({ own_pickup_id: "11111111-1111-1111-1111-111111111111" });
    const { html } = await render();
    const has = html.includes('href="/reservations/res-1/evidence/11111111-1111-1111-1111-111111111111"');
    expect(has).toBe(role === "employee");
  });
});
