import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import dict from "@/lib/i18n/dictionaries/pt-BR";
import {
  loadOperationalWorkspace,
  type OperationalData,
} from "@/lib/operations/load";
import { MaintenanceWorkspace } from "./MaintenanceWorkspace";
import { AdminWorkspace } from "../admin/AdminWorkspace";
import { Workspace } from "./Workspace";
import { FmShell } from "../carpool/FmShell";
vi.mock("@/lib/operations/load", () => ({ loadOperationalWorkspace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/maintenance",
}));
vi.mock("@/lib/i18n/getLocale", () => ({
  getDictionary: async () => dict,
  getLocale: async () => "pt-BR",
}));
vi.mock("@/app/shellData", async (original) => ({
  ...(await original<typeof import("@/app/shellData")>()),
  loadShellContext: async () => ({
    locale: "pt-BR",
    dict,
    roleLabels: {
      maintenance_operator: "Manutenção",
      administrator: "Administrador",
    },
    licenseMissing: false,
    avatarUrl: null,
    licenseGateActive: false,
    chatInitialState: { status: "idle", messages: [] },
  }),
}));
vi.mock("@/app/ChatWidget", () => ({
  ChatWidget: () => null,
  OPEN_CHAT_EVENT: "test-chat",
}));
vi.mock("@/app/dashboard/actions", () => ({ signOut: async () => {} }));
vi.mock("@/app/operations/actions", () => ({
  executeOperation: async () => {},
}));
vi.mock("@/app/admin/actions", () => ({ adminCommand: async () => {} }));
function fixture(): OperationalData {
  const governance = {
    policy: { enabled: false, version: 2, confirmation_required: true },
    policy_versions: [
      {
        id: "pv",
        version: 2,
        assistant_enabled: false,
        reason: "Política de teste",
        created_at: "2026-10-16T12:00:00Z",
      },
    ],
    privacy_requests: [],
  };
  const db = {
    rpc: async () => ({ data: governance, error: null }),
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: () => q,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return q;
    },
  };
  return {
    db,
    profile: {
      id: "actor",
      full_name: "Operador de teste",
      role: "maintenance_operator",
      organization_id: "org",
      organization: { name: "Organização de teste" },
    },
    vehicles: [
      {
        id: "v",
        plate: "TEST001",
        name: "Veículo de teste",
        vin: null,
        next_service_date: "2026-12-01",
        status: "available",
        odometer_km: 9000,
        next_service_odometer_km: 10000,
        current_location_id: "l",
        category: { name: "Modelo teste", energy_type: "BEV" },
        current_location: { name: "Local de teste" },
      },
    ],
    locations: [{ id: "l", name: "Local de teste" }],
    records: {
      orders: [
        {
          id: "o",
          vehicle_id: "v",
          number: 1,
          kind: "preventive",
          status: "budgeted",
          description: "Revisão de teste",
          supplier: "Oficina de teste",
          quote_total: 500,
          approved_total: null,
          scheduled_start: null,
          scheduled_end: null,
          version: 2,
          created_at: "2026-10-16T12:00:00Z",
          completed_at: null,
          workflow_task_id: null,
        },
      ],
      lines: [
        {
          id: "line",
          work_order_id: "o",
          description: "Serviço de teste",
          category: "labor",
          quantity: 1,
          unit_price: 100,
          warranty: false,
          created_at: "2026-10-16T12:00:00Z",
          voided_at: null,
          void_reason: null,
        },
      ],
      energy: null,
      gate: null,
      acknowledgements: null,
    },
    unavailable: false,
    manager: false,
    migrationUnavailable: false,
  } as unknown as OperationalData;
}
beforeEach(() => {
  vi.mocked(loadOperationalWorkspace).mockResolvedValue(fixture());
});
async function html(element: ReactElement, name: string) {
  const frame = await Workspace(
    element.props as Parameters<typeof Workspace>[0],
  );
  const shell = await FmShell(frame.props as Parameters<typeof FmShell>[0]);
  const markup = renderToStaticMarkup(shell);
  if (process.env.FLEET_VISUAL_DIR) {
    mkdirSync(process.env.FLEET_VISUAL_DIR, { recursive: true });
    writeFileSync(
      path.join(process.env.FLEET_VISUAL_DIR, name + ".html"),
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${markup}</html>`,
    );
  }
  return markup;
}
describe("operational workspace rendering", () => {
  it.each(["overview", "planning", "orders", "vehicle"] as const)(
    "renders maintenance %s without turning absent data into a successful operation",
    async (view) => {
      const content = await html(
        await MaintenanceWorkspace({ view, params: {} }),
        "maintenance-" + view,
      );
      expect(content).toContain("TEST001");
      expect(content).not.toContain("Operação registrada e auditada.");
      expect(content).toContain("fleetmind-main");
    },
  );
  it("offers no approval control to an operator and preserves real financial line totals", async () => {
    const content = await html(
      await MaintenanceWorkspace({ view: "orders", params: {} }),
      "maintenance-orders",
    );
    expect(content).not.toContain("Aprovar orçamento");
    expect(content).toContain("Serviço de teste");
    expect(content).toContain("100,00");
  });
  it.each(["overview", "integrations", "audit", "ai"] as const)(
    "renders administration %s from the actual view",
    async (view) => {
      const d = fixture();
      d.profile.role = "administrator";
      d.manager = true;
      vi.mocked(loadOperationalWorkspace).mockResolvedValue(d);
      const content = await html(
        await AdminWorkspace({ view, params: {} }),
        "admin-" + view,
      );
      expect(content).toContain("Administração");
      if (view === "ai") {
        expect(content).toContain("Desativado");
        expect(content).toContain("Política de teste");
      }
      if (view === "integrations") {
        expect(content).toContain("Sem adapter validado");
        expect(content).not.toContain("SAP ativo");
      }
    },
  );
});
