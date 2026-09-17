"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for a Server Component `<form action={serverAction}>`.
 *
 * Those forms have no `useActionState` slot, so there was nothing anywhere tracking the
 * in-flight state of a submission: a slow network produced a button that looked idle and
 * invited a second click (double approval, double swap). `useFormStatus()` reads the
 * pending state of the enclosing form, which is the only hook that works from inside a
 * server-rendered form — hence this tiny client boundary around the button itself rather
 * than turning whole pages into client components.
 *
 * `confirmMessage` is optional: when present the click is gated by a native `confirm()`
 * (see ConfirmSubmitButton, which is this component with that prop required).
 */
export function SubmitButton({
  confirmMessage,
  pendingLabel,
  disabled,
  className,
  title,
  children,
}: {
  confirmMessage?: string;
  /** Replaces the label while the form is submitting. Falls back to `children`. */
  pendingLabel?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      title={title}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
