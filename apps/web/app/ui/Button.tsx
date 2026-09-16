import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "tertiary";

const VARIANT_CLASSES: Record<Variant, string> = {
  // Primary — solid GWM blue, sanctioned by the brand book as the one place the
  // accent color may be a filled background (gwm-design skill, §5/§3.3).
  primary:
    "bg-signal-amber text-ink-950 hover:opacity-90 focus-visible:outline-signal-amber disabled:opacity-50",
  secondary:
    "border border-line-800 text-paper-50 hover:bg-panel-800 focus-visible:outline-signal-amber disabled:opacity-50",
  tertiary:
    "text-paper-50 hover:text-signal-amber underline-offset-2 hover:underline focus-visible:outline-signal-amber",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    variant === "tertiary"
      ? "inline-flex items-center gap-1.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      : "inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-sm font-semibold uppercase tracking-widest transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return <button className={`${base} ${VARIANT_CLASSES[variant]} ${className}`} {...props} />;
}
