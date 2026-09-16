"use client";

import { useEffect, useState } from "react";
import { DAMAGE_PHOTO_ANGLE, STANDARD_PHOTO_ANGLES } from "@/lib/domain/checklist";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

/**
 * Standardized photo capture for pickup/return checklists (fleet-car-saas.txt §10).
 * Shared between PickupForm and ReturnForm — both require the same seven angles, so
 * one component avoids duplicating the field markup and preview/cleanup logic twice.
 *
 * Each field is a plain `<input type="file" accept="image/*" capture="environment">`
 * inside the checklist's own <form>, named `photo_<angle>` — no separate submit step,
 * no camera library. The browser hands the picked File straight to the enclosing
 * form's FormData, which the page's submit handler forwards to the server action
 * alongside the rest of the checklist fields.
 */

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.4l.9-1.5A1.5 1.5 0 0 1 10.15 4.75h3.7a1.5 1.5 0 0 1 1.35.85L16.1 7h2.4A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  );
}

function PhotoCaptureField({
  name,
  label,
  hint,
  dict,
}: {
  name: string;
  label: string;
  hint?: string;
  dict: Dictionary;
}) {
  const t = dict.reservations.photos;
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2.5 transition-colors hover:border-line-700 focus-within:border-signal-teal">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line-800 bg-panel-800">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not a remote asset
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <CameraIcon className="h-5 w-5 text-fog-600" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{label}</span>
        <span className="truncate font-mono text-[11px] text-fog-600">
          {file ? file.name : (hint ?? t.tapToCapture)}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-widest ${
          file ? "border-signal-teal text-signal-teal" : "border-line-700 text-fog-400"
        }`}
      >
        {file ? t.captured : t.capture}
      </span>
      <input
        type="file"
        name={name}
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function PhotoCaptureSection({ dict }: { dict: Dictionary }) {
  const t = dict.reservations.photos;

  return (
    <fieldset className="flex flex-col gap-2 border-t border-line-800 pt-4">
      <legend className="mb-1 text-xs font-medium uppercase tracking-widest text-fog-400">
        {t.legend}
      </legend>
      <p className="-mt-1 mb-1 text-xs text-fog-600">{t.hint}</p>
      <div className="flex flex-col gap-2">
        {STANDARD_PHOTO_ANGLES.map((angle) => (
          <PhotoCaptureField
            key={angle.value}
            name={`photo_${angle.value}`}
            label={t.angles[angle.value]}
            dict={dict}
          />
        ))}
        <PhotoCaptureField
          name={`photo_${DAMAGE_PHOTO_ANGLE.value}`}
          label={t.angles[DAMAGE_PHOTO_ANGLE.value]}
          hint={t.damageHint}
          dict={dict}
        />
      </div>
    </fieldset>
  );
}
