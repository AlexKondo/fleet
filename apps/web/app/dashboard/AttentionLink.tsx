"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { jumpToAttention } from "@/lib/dashboard/attentionJump";

type Props = { targetId: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

/**
 * The "Veículos que precisam de atenção" number. Clicked, the page travels to those vehicles' cards (lib/dashboard/attentionJump.ts). Opened in a new tab,
 * or before the page is ready, it is a plain link to the vehicle section.
 */
export function AttentionLink({ targetId, children, ...rest }: Props) {
  return (
    <a
      {...rest}
      href={`#${targetId}`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const section = document.getElementById(targetId);
        if (!section) return;
        event.preventDefault();
        jumpToAttention(section);
      }}
    >
      {children}
    </a>
  );
}
