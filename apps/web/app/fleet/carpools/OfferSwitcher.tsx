"use client";

import { useEffect } from "react";

/**
 * Choosing an offer in the list is instant: every offer of the page already has its details on the page (hidden), so a click only moves the
 * "selected" mark, shows that offer's details and updates the address. Without script (or with Ctrl/Shift/middle click) the link still works as before.
 */
export function OfferSwitcher() {
  useEffect(() => {
    const layout = document.querySelector<HTMLElement>(".cm-layout");
    if (!layout) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest<HTMLAnchorElement>("a.cm-offer[data-offer]");
      if (!link || !layout.contains(link)) return;
      const id = link.dataset.offer;
      const panel = [...layout.querySelectorAll<HTMLElement>("[data-offer-detail]")].find((el) => el.dataset.offerDetail === id);
      if (!id || !panel) return;
      e.preventDefault();
      layout.querySelectorAll<HTMLElement>("[data-offer-detail]").forEach((el) => { el.hidden = el !== panel; });
      layout.querySelectorAll<HTMLElement>("a.cm-offer").forEach((el) => {
        const on = el === link;
        el.classList.toggle("selected", on);
        if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
      });
      window.history.replaceState(window.history.state, "", link.getAttribute("href") ?? window.location.href);
    };
    layout.addEventListener("click", onClick);
    return () => layout.removeEventListener("click", onClick);
  }, []);
  return null;
}
