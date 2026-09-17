"use client";

import { SubmitButton } from "./ui/SubmitButton";

/**
 * Submit button for a destructive form action (delete/cancel/reject). Browser-native
 * `confirm()` instead of a custom dialog component — there's no modal system in this
 * codebase yet, and a native confirm is enough friction to stop an accidental click
 * without adding one just for this.
 *
 * Thin wrapper over `SubmitButton`, which also disables the button (and can swap its
 * label) while the enclosing server-action form is in flight — that behaviour lives in
 * one place so every call site gets it instead of nine hand-rolled copies.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  pendingLabel,
  disabled,
  className,
  title,
  children,
}: {
  confirmMessage: string;
  pendingLabel?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <SubmitButton
      confirmMessage={confirmMessage}
      pendingLabel={pendingLabel}
      disabled={disabled}
      className={className}
      title={title}
    >
      {children}
    </SubmitButton>
  );
}
