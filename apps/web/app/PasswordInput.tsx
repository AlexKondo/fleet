"use client";

import { useId, useState } from "react";

/**
 * A password `<input>` with a show/hide toggle — without one, a typo is invisible until
 * the very next login attempt fails, which is a particularly bad failure mode on
 * /signup: there's no "confirm password" step in this app that a mistyped password
 * would even get caught by without one, and a locked-out founder has no self-service way
 * back in (no email delivery configured yet — see signUpOrganization.ts).
 */
export function PasswordInput({
  name,
  label,
  autoComplete,
  required,
  minLength,
  placeholder,
  onValueChange,
}: {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  /** Optional — lets a parent form track the live value (e.g. for a "confirm password" match check) without making this a fully controlled input. */
  onValueChange?: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();

  return (
    <label className="flex flex-col gap-1.5" htmlFor={inputId}>
      <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{label}</span>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          name={name}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={onValueChange ? (e) => onValueChange(e.target.value) : undefined}
          className="w-full rounded-sm border border-line-800 bg-panel-900 px-3 py-2.5 pr-11 font-mono text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-fog-400 hover:text-signal-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber"
        >
          {visible ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a3 3 0 0 0 4.24 4.24" />
              <path d="M6.6 6.7C4.2 8.2 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3M17.4 17.3C19.8 15.8 22 12 22 12s-1.3-2.6-3.7-4.6" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}
