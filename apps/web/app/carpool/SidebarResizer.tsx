"use client";

import { useRef } from "react";
import { clampSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, sidebarCookieName } from "@/lib/ui/sidebarWidth";

/**
 * The drag handle on the right edge of the side menu. Drag (or use the arrow keys) to change the width, double-click (or Home) to go back to the
 * default. The width is set live on the menu and saved for this user when the drag ends.
 */
export function SidebarResizer({ userId, initialWidth, label }: { userId: string | null; initialWidth: number; label: string }) {
  const width = useRef(initialWidth);
  const handle = useRef<HTMLDivElement>(null);

  const apply = (next: number) => {
    width.current = clampSidebarWidth(next);
    const aside = handle.current?.closest("aside");
    aside?.style.setProperty("--fm-sidebar-w", `${width.current}px`);
    handle.current?.setAttribute("aria-valuenow", String(width.current));
  };
  const save = () => {
    try {
      document.cookie = `${sidebarCookieName(userId)}=${width.current}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // the width still applies for this page view
    }
  };

  return (
    <div
      ref={handle}
      className="fm-sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={initialWidth}
      tabIndex={0}
      data-testid="sidebar-resizer"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.classList.add("fm-resizing");
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const left = handle.current?.closest("aside")?.getBoundingClientRect().left ?? 0;
        apply(e.clientX - left);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove("fm-resizing");
        save();
      }}
      onDoubleClick={() => {
        apply(SIDEBAR_DEFAULT);
        save();
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 30 : 10;
        if (e.key === "ArrowLeft") apply(width.current - step);
        else if (e.key === "ArrowRight") apply(width.current + step);
        else if (e.key === "Home") apply(SIDEBAR_DEFAULT);
        else return;
        e.preventDefault();
        save();
      }}
    />
  );
}
