import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import dict from "@/lib/i18n/dictionaries/pt-BR";
import AccountPage from "./page";
import LicensePage from "./license/page";
import ProfilePage from "./profile/page";
import { FmShell } from "../carpool/FmShell";

/**
 * FIX-VISUAL: /account, /account/license and /account/profile moved from the legacy AppShell to FmShell. The CNH gate
 * must behave exactly as before: these pages never opt into `nonDrivingWorkspace`, so the gate is the plain
 * `licenseGateActive` of loadShellContext (same source AppShell used) — while it is active there is no sidebar, no
 * chat, no bell, a role=alert notice (with the key-custody shortcut for designated custodians), and the page content
 * (password change, CNH capture, own profile with the locked e-mail / license-derived fields) stays reachable.
 */
const s = vi.hoisted(() => ({ role: "employee", gate: false, custody: false, license: null as null | Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/account",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/currentUser", () => ({
  getCurrentUser: async () => ({ id: "user-1", email: "pessoa@example.invalid" }),
}));
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.single = async () => ({
    data: { full_name: "Pessoa de teste", role: s.role, avatar_url: null, organization: { name: "Organização de teste" } },
    error: null,
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: () => builder() }) }));
vi.mock("../../lib/auth/ownLicense", () => ({ getOwnLicense: async () => s.license }));
vi.mock("@/lib/i18n/getLocale", () => ({ getDictionary: async () => dict, getLocale: async () => "pt-BR" }));
vi.mock("./actions", () => ({ changePassword: async () => ({ status: "idle" }) }));
vi.mock("./license/actions", () => ({ submitLicensePhoto: async () => ({ status: "idle" }) }));
vi.mock("./profile/actions", () => ({ updateOwnProfile: async () => ({ status: "idle" }) }));
vi.mock("@/app/shellData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/shellData")>();
  return {
    ...actual,
    loadShellContext: async () => ({
      locale: "pt-BR",
      dict,
      roleLabels: {},
      licenseMissing: s.gate,
      avatarUrl: null,
      licenseGateActive: s.gate,
      chatInitialState: { status: "idle", messages: [] },
      canKeyCustody: s.custody,
      canBudgetApproval: false,
    }),
  };
});
vi.mock("@/app/ChatWidget", () => ({ ChatWidget: () => "CHAT-WIDGET", OPEN_CHAT_EVENT: "fleet-test-chat" }));
vi.mock("@/app/dashboard/actions", () => ({ signOut: async () => {} }));

type ShellProps = Parameters<typeof FmShell>[0];
async function render(el: Promise<unknown>) {
  const shell = (await el) as ReactElement<ShellProps>;
  expect(shell.type).toBe(FmShell);
  return { props: shell.props, html: renderToStaticMarkup(await FmShell(shell.props)) };
}
const pages = {
  account: () => AccountPage({ searchParams: Promise.resolve({}) }),
  license: () => LicensePage(),
  profile: () => ProfilePage(),
} as const;

beforeEach(() => {
  s.role = "employee";
  s.gate = false;
  s.custody = false;
  s.license = null;
});

describe("account pages render inside FmShell and keep the CNH gate", () => {
  it.each(Object.keys(pages) as (keyof typeof pages)[])("%s: new shell, never a non-driving workspace", async (name) => {
    for (const role of ["employee", "fleet_manager", "administrator", "security", "maintenance_operator"]) {
      s.role = role;
      const { props, html } = await render(pages[name]());
      expect(props.role).toBe(role);
      expect(props.nonDrivingWorkspace ?? false).toBe(false);
      expect(props.isFleetManager).toBe(role === "fleet_manager" || role === "administrator");
      expect(props.isAdministrator).toBe(role === "administrator");
      expect(html).toContain('data-testid="fm-theme"');
      expect(html).toContain('class="fm-sidebar"');
      expect(html).toContain("CHAT-WIDGET");
      expect(html).not.toContain("md:w-60");
    }
  });

  it.each(Object.keys(pages) as (keyof typeof pages)[])("%s: gate active hides navigation/chat/bell but keeps the page content", async (name) => {
    s.gate = true;
    const { html } = await render(pages[name]());
    expect(html).toContain('data-testid="fm-theme"');
    expect(html).not.toContain('class="fm-sidebar"');
    expect(html).not.toContain('class="fm-bottom-nav"');
    expect(html).not.toContain("CHAT-WIDGET");
    expect(html).toContain('role="alert"');
    expect(html).toContain(dict.chrome.licenseGateNotice);
    expect(html).not.toContain('href="/account/keys"');
    expect(html).toContain(`aria-label="${dict.chrome.signOut}"`); // sign-out stays available during the gate
    expect(html).toContain("<form"); // the page's own form (password / CNH / profile) is rendered
  });

  it("gate active + designated key custodian: the custody shortcut is offered", async () => {
    s.gate = true;
    s.custody = true;
    const { html } = await render(pages.license());
    expect(html).toContain('href="/account/keys"');
  });

  it("/account keeps the forced password change notice", async () => {
    const { html } = await render(AccountPage({ searchParams: Promise.resolve({ forcePasswordChange: "1" }) }));
    expect(html).toContain(dict.account.forcedChangeNotice);
    expect(html).toContain('href="/account/privacy"');
  });

  it("/account/profile keeps the e-mail locked and the license-derived fields read-only", async () => {
    s.license = { number: "01234567890", category: "B", expiration: "2033-06-29" };
    const { html } = await render(pages.profile());
    expect(html).toMatch(new RegExp(`type="email"[^>]*disabled=""[^>]*title="${dict.account.profile.emailImmutableHint}"`));
    expect(html).toContain(dict.account.profile.nameFromLicenseHint);
    expect(html).toContain(dict.account.profile.licenseSectionTitle);
    expect(html).toContain("01234567890");
    expect(html).toContain("29-06-2033");
  });
});
