"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Instant click feedback for in-app navigation (the page itself is rendered on the server: login check + database reads, so the
 * new screen needs ~1s). Within one frame of a plain left-click on an internal link inside the themed shell the clicked link lights
 * up, a thin progress bar runs along the top and the content dims; everything is cleared as soon as the pathname changes. It never
 * intercepts or delays the navigation itself.
 */
export function NavFeedback() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".fm-theme");
    if (!root) return;
    root.removeAttribute("data-nav-pending");
    root.querySelectorAll("[data-pending]").forEach((el) => el.removeAttribute("data-pending"));
  }, [pathname]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      const root = document.querySelector<HTMLElement>(".fm-theme");
      if (!anchor || !root || !root.contains(anchor)) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//") || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(href, window.location.origin);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      anchor.setAttribute("data-pending", "true");
      root.setAttribute("data-nav-pending", "true");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        root.removeAttribute("data-nav-pending");
        root.querySelectorAll("[data-pending]").forEach((el) => el.removeAttribute("data-pending"));
      }, 20000);
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <div className="fm-navbar" aria-hidden="true" />;
}
