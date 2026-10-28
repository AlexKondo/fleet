import Link from "next/link";
import { getAreaText } from "@/lib/i18n/areaText";
import { teamTabsTexts } from "@/lib/i18n/areas/teamTabs";

export type TeamTab = "people" | "drivers" | "contact";

/**
 * "Equipe" is ONE place for everything about people. The side menu has a single item for it; these tabs switch between its sections:
 * people and roles (administrator), drivers and license (fleet manager and administrator), direct manager and WhatsApp (administrator).
 */
export async function TeamTabs({ active, isAdministrator }: { active: TeamTab; isAdministrator: boolean }) {
  const T = await getAreaText(teamTabsTexts);
  const tabs: { key: TeamTab; href: string; label: string; visible: boolean }[] = [
    { key: "people", href: "/settings/users", label: T.people, visible: isAdministrator },
    { key: "drivers", href: "/fleet/drivers", label: T.drivers, visible: true },
    { key: "contact", href: "/settings/approvals", label: T.contact, visible: isAdministrator },
  ];
  return (
    <nav className="fm-tabs" aria-label={T.aria} data-testid="team-tabs">
      {tabs.filter((t) => t.visible).map((t) => (
        <Link key={t.key} href={t.href} className="fm-tab" aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
