"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTabHref } from "@/lib/nav/sections";

/** The tabs of an area of the side menu; the current tab is the one that matches the address (also after a click, without reloading). */
export function SectionTabs({ tabs, ariaLabel }: { tabs: { href: string; label: string }[]; ariaLabel: string }) {
  const pathname = usePathname() ?? "";
  const current = activeTabHref(tabs, pathname);
  if (tabs.length < 2) return null;
  return (
    <nav className="fm-tabs" aria-label={ariaLabel} data-testid="section-tabs">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="fm-tab" aria-current={t.href === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
