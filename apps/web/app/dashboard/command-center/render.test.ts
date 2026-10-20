import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import dict from "@/lib/i18n/dictionaries/pt-BR";
import { loadCommandCenter } from "@/lib/dashboard/loadCommandCenter";
import Page from "./page";
import { FmShell } from "../../carpool/FmShell";

const state = vi.hoisted(() => ({ role: "fleet_manager", signedIn: true }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard/command-center",
}));
vi.mock("@/lib/dashboard/loadCommandCenter", () => ({
  loadCommandCenter: vi.fn(),
}));
vi.mock("@/lib/auth/currentUser", () => ({
  getCurrentUser: async () =>
    state.signedIn ? { id: "user", email: "fixture@example.invalid" } : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              role: state.role,
              full_name: "Usuário de teste",
              organization_id: "org",
              organization: { name: "Organização de teste" },
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/i18n/getLocale", () => ({
  getDictionary: async () => dict,
  getLocale: async () => "pt-BR",
}));
vi.mock("@/app/shellData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/shellData")>();
  return {
    ...actual,
    loadShellContext: async () => ({
      locale: "pt-BR",
      dict,
      roleLabels: { fleet_manager: "Gestor de Frota" },
      licenseMissing: false,
      avatarUrl: null,
      licenseGateActive: false,
      chatInitialState: { status: "idle", messages: [] },
    }),
  };
});
vi.mock("@/app/ChatWidget", () => ({
  ChatWidget: () => null,
  OPEN_CHAT_EVENT: "fleet-test-chat",
}));
vi.mock("@/app/dashboard/actions", () => ({ signOut: async () => {} }));

type Data = Awaited<ReturnType<typeof loadCommandCenter>>;
const fixture = (): Data => ({
  range: {
    period: "7d",
    from: "2026-10-10T03:00:00Z",
    to: "2026-10-17T03:00:00Z",
  },
  selectedLocation: "all",
  vehicles: [
    {
      id: "v1",
      plate: "TEST001",
      status: "available",
      current_location_id: "l1",
      odometer_km: 5000,
      next_service_odometer_km: 10000,
      category: { name: "BEV teste", energy_type: "BEV" },
      current_location: { name: "Local de teste" },
    },
  ],
  locations: [{ id: "l1", name: "Local de teste" }],
  reservations: [],
  tasks: [],
  rides: [],
  daily: [{ day: "2026-10-16", count: 0 }],
  degraded: false,
});
beforeEach(() => {
  state.role = "fleet_manager";
  state.signedIn = true;
  vi.mocked(loadCommandCenter).mockResolvedValue(fixture());
});

async function render() {
  const element = await Page({
    searchParams: Promise.resolve({ period: "7d" }),
  });
  const shell = await FmShell(
    (element as ReactElement<Parameters<typeof FmShell>[0]>).props,
  );
  return renderToStaticMarkup(shell);
}
describe("command center page access and rendering", () => {
  it("redirects unauthenticated visitors before loading any fleet records", async () => {
    state.signedIn = false;
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/login",
    );
  });
  it.each(["employee", "security", "maintenance_operator"])(
    "rejects %s before fleet queries",
    async (role) => {
      state.role = role;
      const calls = vi.mocked(loadCommandCenter).mock.calls.length;
      await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
        "REDIRECT:/dashboard",
      );
      expect(vi.mocked(loadCommandCenter).mock.calls).toHaveLength(calls);
    },
  );
  it("renders the actual shell and command center with explicit unavailable metrics", async () => {
    const html = await render();
    expect(html).toContain("Fleet Command Center 360°");
    expect(html).toContain("Mapa indisponível");
    expect(html).toContain("Fonte de cálculo pendente");
    expect(html).toContain("TEST001");
    expect(html).not.toContain("R$ 3.450");
    expect(html).toContain("period=30d");
    if (process.env.FLEET_VISUAL_DIR) {
      const dir = process.env.FLEET_VISUAL_DIR;
      mkdirSync(dir, { recursive: true });
      const css = [
        "app/carpool/fm-theme.css",
        "app/carpool/fm-shared.css",
        "app/fm-ops.css",
        "app/dashboard/command-center/command-center.css",
      ]
        .map((p) => readFileSync(path.resolve(p), "utf8"))
        .join("\n");
      writeFileSync(
        path.join(dir, "command-center.html"),
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button,input,select{font:inherit}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style>${html}</html>`,
      );
    }
  });
  it("renders a degraded source as unavailable instead of a healthy empty state", async () => {
    vi.mocked(loadCommandCenter).mockResolvedValue({
      ...fixture(),
      vehicles: null,
      tasks: null,
      rides: null,
      reservations: null,
      degraded: true,
    });
    const html = await render();
    expect(html).toContain("Algumas fontes não responderam");
    expect(html).toContain("Alertas indisponíveis");
    expect(html).not.toContain("Não há tarefas operacionais abertas");
  });
});
