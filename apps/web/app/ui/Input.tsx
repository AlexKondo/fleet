import { type InputHTMLAttributes, type ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-widest text-fog-400">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-signal-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-sm border border-line-800 bg-panel-900 px-3 py-2.5 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber ${className}`}
      {...props}
    />
  );
}
