"use client";

import { useEffect, useRef, useState } from "react";
import { DAMAGE_PHOTO_ANGLE, STANDARD_PHOTO_ANGLES } from "@/lib/domain/checklist";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import { CameraCaptureModal } from "./CameraCaptureModal";

/**
 * Standardized photo capture for pickup/return checklists (fleet-car-saas.txt §10).
 * Shared between PickupForm and ReturnForm — both require the same seven angles, so
 * one component avoids duplicating the field markup and preview/cleanup logic twice.
 *
 * "Capturar" opens a live getUserMedia camera modal (CameraCaptureModal) — works the same
 * on desktop and mobile, unlike `<input capture>` which desktop browsers ignore. The
 * upload button opens a plain file picker.
 *
 * Captured files are reported to the enclosing form via `onFileChange`, NOT via a hidden
 * `<input type="file">` synced through `DataTransfer` (the previous approach) — that
 * relied on the browser's native FormData collection actually picking up a `.files`
 * value assigned by JS, which is exactly the kind of thing that silently no-ops on some
 * mobile browsers: no error anywhere, the field is just treated as "no photo provided"
 * server-side, so a pickup could complete looking entirely normal on the phone while the
 * photo never left it. Handing the File object to the parent directly and letting it
 * `formData.set()` the file into the FormData it already owns removes that entire failure
 * class — no DOM/browser serialization step for these fields at all.
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

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

function Thumbnail({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm border border-line-800 bg-panel-800">
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not a remote asset
        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-sm bg-black/70 text-[10px] leading-none text-paper-50 hover:bg-signal-red"
      >
        ×
      </button>
    </span>
  );
}

/**
 * Multiple photos per angle: RODAS/INTERIOR etc. often need more than one shot to
 * actually document the vehicle's condition — one hidden fixed-width preview box only
 * ever kept the most recent capture. Every call to "Capturar"/upload now ADDS a photo
 * instead of replacing the previous one; `inspection_photos` has no uniqueness
 * constraint on (inspection_id, angle) (0002_operational_cycle.sql), so multiple rows
 * per angle already round-trip fine — only the storage path needed to stop colliding
 * (uploadInspectionPhotos.ts numbers them `${angle}_${index}.${ext}`).
 */
function PhotoCaptureField({
  name,
  label,
  hint,
  dict,
  onFileChange,
}: {
  name: string;
  label: string;
  hint?: string;
  dict: Dictionary;
  onFileChange: (name: string, files: File[]) => void;
}) {
  const t = dict.reservations.photos;
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  function commit(next: File[]) {
    setFiles(next);
    onFileChange(name, next);
  }

  function handlePicked(picked: File | undefined | null) {
    if (!picked) return;
    if (picked.size > MAX_PHOTO_BYTES) {
      setError(t.fileTooLarge);
      return;
    }
    setError(null);
    commit([...files, picked]);
  }

  function handleRemove(index: number) {
    commit(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2.5 transition-colors hover:border-line-700">
        <span className="flex shrink-0 items-center gap-1.5">
          {files.length > 0 ? (
            files.map((f, i) => (
              <Thumbnail key={`${f.name}-${f.lastModified}-${i}`} file={f} onRemove={() => handleRemove(i)} />
            ))
          ) : (
            <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-sm border border-line-800 bg-panel-800">
              <CameraIcon className="h-5 w-5 text-fog-600" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{label}</span>
          <span className="truncate font-mono text-[11px] text-fog-600">
            {files.length > 0 ? withCount(t.photoCount, files.length) : (hint ?? t.tapToCapture)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          className={`shrink-0 rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase tracking-widest ${
            files.length > 0 ? "border-signal-teal text-signal-teal" : "border-line-700 text-fog-400 hover:border-line-600"
          }`}
        >
          {files.length > 0 ? t.captureAnother : t.capture}
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
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            for (const picked of e.target.files ?? []) handlePicked(picked);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <p className="text-[11px] text-signal-red">{error}</p> : null}
      {showCamera ? (
        <CameraCaptureModal dict={dict} onCapture={handlePicked} onClose={() => setShowCamera(false)} />
      ) : null}
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
  onFileChange,
}: {
  dict: Dictionary;
  includeDamageAngle?: boolean;
  /** Called with (fieldName, files) every time this field's photo list changes (add or
   * remove) — the caller is responsible for injecting these into its own FormData at
   * submit time (see PickupForm/ReturnForm's handleSubmit). */
  onFileChange: (name: string, files: File[]) => void;
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
            onFileChange={onFileChange}
          />
        ))}
        {includeDamageAngle ? (
          <PhotoCaptureField
            name={`photo_${DAMAGE_PHOTO_ANGLE.value}`}
            label={t.angles[DAMAGE_PHOTO_ANGLE.value]}
            hint={t.damageHint}
            dict={dict}
            onFileChange={onFileChange}
          />
        ) : null}
      </div>
    </fieldset>
  );
}
