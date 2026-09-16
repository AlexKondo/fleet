import { type HTMLAttributes } from "react";

/**
 * Flat surface, no shadow — GWM brand rule bans decorative shadows/3D effects
 * (gwm-design skill §1.5). Separation comes from a 1px border, never elevation.
 */
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md border border-line-800 bg-panel-900/60 p-6 ${className}`} {...props} />;
}
