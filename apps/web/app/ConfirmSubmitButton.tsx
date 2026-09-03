"use client";

/**
 * Submit button for a destructive form action (delete). Browser-native `confirm()`
 * instead of a custom dialog component — there's no modal system in this codebase yet,
 * and a native confirm is enough friction to stop an accidental click without adding one
 * just for this.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  disabled,
  className,
  children,
}: {
  confirmMessage: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
