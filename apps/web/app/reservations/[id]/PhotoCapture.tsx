"use client";

import { useEffect, useRef, useState } from "react";
import { DAMAGE_PHOTO_ANGLE, STANDARD_PHOTO_ANGLES } from "@/lib/domain/checklist";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

/**
 * Standardized photo capture for pickup/return checklists (fleet-car-saas.txt §10).
 * Shared between PickupForm and ReturnForm — both require the same seven angles, so
 * one component avoids duplicating the field markup and preview/cleanup logic twice.
 *
 * Two hidden trigger inputs per field — one with `capture="environment"` (opens the
 * device camera directly), one plain (opens the file/gallery picker) — feed a single
 * hidden `<input type="file" name="photo_<angle>">` whose `.files` is set
 * programmatically via DataTransfer, so the enclosing form's FormData still only ever
 * sees one entry per field name no matter which button was used.
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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

function UploadIcon({ className }: { className?: string }) {
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
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M7 9l5-5 5 5" />
      <path d="M12 4v12" />
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
  const [error, setError] = useState<string | null>(null);
  const formInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Keeps the real (submitted) file input in sync with whichever trigger picked a
  // file — camera or upload both funnel through here, so the enclosing form's
  // FormData only ever has one entry for this field name.
  useEffect(() => {
    const input = formInputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
  }, [file]);

  function handlePicked(picked: File | undefined | null) {
    if (!picked) return;
    if (picked.size > MAX_PHOTO_BYTES) {
      setError(t.fileTooLarge);
      return;
    }
    setError(null);
    setFile(picked);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2.5 transition-colors hover:border-line-700">
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
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className={`shrink-0 rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-widest ${
            file ? "border-signal-teal text-signal-teal" : "border-line-700 text-fog-400 hover:border-line-600"
          }`}
        >
          {file ? t.captured : t.capture}
        </button>
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          title={t.upload}
          aria-label={t.upload}
          className="shrink-0 rounded-sm border border-line-700 p-1.5 text-fog-400 hover:border-line-600 hover:text-paper-50"
        >
          <UploadIcon className="h-4 w-4" />
        </button>
        <input ref={formInputRef} type="file" name={name} className="sr-only" tabIndex={-1} />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => handlePicked(e.target.files?.[0])}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => handlePicked(e.target.files?.[0])}
        />
      </div>
      {error ? <p className="text-[11px] text-signal-red">{error}</p> : null}
    </div>
  );
}

/**
 * The standard angles are always requested (a pickup/return with no damage still needs a
 * "what did this car look like right now" record); `includeDamageAngle` adds the extra
 * damage-specific field, and is driven by the checklist's own damage checkbox.
 */
export function PhotoCaptureSection({
  dict,
  includeDamageAngle = false,
}: {
  dict: Dictionary;
  includeDamageAngle?: boolean;
}) {
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
        {includeDamageAngle ? (
          <PhotoCaptureField
            name={`photo_${DAMAGE_PHOTO_ANGLE.value}`}
            label={t.angles[DAMAGE_PHOTO_ANGLE.value]}
            hint={t.damageHint}
            dict={dict}
          />
        ) : null}
      </div>
    </fieldset>
  );
}
