"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitLicensePhoto, type LicenseUploadState } from "./actions";
import { CameraCaptureModal } from "../../reservations/[id]/CameraCaptureModal";
import { Button } from "../../ui/Button";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

const DONE_STATUSES: LicenseUploadState["status"][] = ["success", "success_expired"];

const initialState: LicenseUploadState = { status: "idle" };
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function LicenseCaptureForm({ dict }: { dict: Dictionary }) {
  const t = dict.account.license;
  const router = useRouter();
  const [state, formAction, pending] = useActionState(submitLicensePhoto, initialState);
  const isDone = DONE_STATUSES.includes(state.status);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // There's no real progress feed from the vision API — a single request/response, not a
  // stream — so this climbs toward 90% while `pending` is true (purely to signal "still
  // working" on what can be a several-second call) and only completes to 100% once the
  // actual result is back, rather than claiming a precision the process doesn't have.
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (pending) {
      setShowProgress(true);
      setProgress(8);
      const interval = setInterval(() => {
        setProgress((p) => (p < 90 ? Math.min(90, p + 4 + Math.random() * 8) : p));
      }, 220);
      return () => clearInterval(interval);
    }
    setProgress((p) => (p > 0 ? 100 : p));
    const timeout = setTimeout(() => setShowProgress(false), 500);
    return () => clearTimeout(timeout);
  }, [pending]);

  useEffect(() => {
    // A PDF blob URL isn't renderable via <img> — the icon fallback covers it instead
    // of showing a broken-image glyph.
    if (!file || file.type === "application/pdf") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Same reasoning as PhotoCapture.tsx: hand the File to the form's action directly
  // instead of relying on a hidden <input>'s `.files` being synced by JS, which isn't
  // reliably picked up by native FormData collection on every mobile browser.
  function handlePicked(picked: File | undefined | null) {
    if (!picked) return;
    if (picked.size > MAX_PHOTO_BYTES) {
      setError(t.photoTooLarge);
      return;
    }
    setError(null);
    setConfirmed(false);
    setFile(picked);
  }

  function handleSubmit(formData: FormData) {
    if (!file) {
      setError(t.noPhoto);
      return;
    }
    formData.set("photo", file);
    formAction(formData);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fog-400">{t.description}</p>

      <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2.5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line-800 bg-panel-800">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob: preview
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl text-fog-600" aria-hidden="true">
                🪪
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1 text-xs text-fog-400">{file ? file.name : t.capturePrompt}</span>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="shrink-0 whitespace-nowrap rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-line-600"
            >
              {dict.reservations.photos.capture}
            </button>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="shrink-0 whitespace-nowrap rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-line-600"
            >
              {dict.reservations.photos.upload}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            name="photo"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(e) => handlePicked(e.target.files?.[0])}
          />
        </div>

        {showProgress ? (
          <div role="status" className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3 text-sm text-fog-400">
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-700 border-t-gwm-accent"
                aria-hidden="true"
              />
              {t.analyzing}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-800">
              <div
                className="h-full rounded-full bg-gwm-accent transition-[width] duration-200 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-signal-red">
            {error}
          </p>
        ) : null}

        {state.status === "unreadable" ? (
          <div className="rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 p-3 text-sm text-gwm-accent">
            <p>{t.unreadable}</p>
            <p className="mt-2 text-xs text-fog-400">{t.unreadableGiveUp}</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <p role="alert" className="text-sm text-signal-red">
            {state.error}
          </p>
        ) : null}

        {state.status === "success" ? (
          <p role="status" className="text-sm text-signal-teal">
            {t.successValid}
          </p>
        ) : null}

        {state.status === "success_expired" ? (
          <p role="alert" className="text-sm text-signal-red">
            {t.successExpired}
          </p>
        ) : null}

        {isDone && state.read ? (
          <div
            className="relative flex flex-col gap-2 overflow-hidden rounded-sm border border-line-800 bg-panel-900/60 bg-[length:180px] bg-[position:right_-1.5rem_bottom_-1.5rem] bg-no-repeat p-3"
            style={{ backgroundImage: "url(/illustrations/drivers-license.png)" }}
          >
            {/* A solid scrim between the illustration and the text — the image is
                otherwise clearly visible but light enough at the corner to not compete
                with the field values it sits behind. */}
            <div className="pointer-events-none absolute inset-0 bg-panel-900/70" aria-hidden="true" />
            <div className="relative z-10 flex flex-col gap-2">
              {(
                [
                  ["fullName", state.read.fullName],
                  ["number", state.read.number],
                  ["category", state.read.category],
                  ["expirationDate", state.read.expirationDate],
                ] as const
              ).map(([key, value], index) => (
                <div
                  key={key}
                  className="animate-license-field-reveal flex items-center justify-between gap-3 text-sm"
                  style={{ animationDelay: `${index * 180}ms` }}
                >
                  <span className="text-fog-400">{t.readFields[key]}</span>
                  <span className="flex items-center gap-2 font-medium text-paper-50">
                    {value}
                    <span
                      className="animate-license-field-reveal flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-signal-teal text-[10px] text-ink-950"
                      style={{ animationDelay: `${index * 180 + 120}ms` }}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {isDone ? (
          <label className="flex items-center gap-2 text-sm text-fog-400">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-4 w-4"
            />
            {t.confirmReadCheckbox}
          </label>
        ) : null}

        {isDone ? (
          <Button
            type="button"
            onClick={() => router.push("/dashboard")}
            disabled={!confirmed}
            className="self-start"
          >
            {dict.common.close}
          </Button>
        ) : (
          <Button type="submit" disabled={pending || !file} className="self-start">
            {pending ? t.analyzing : state.status === "unreadable" ? t.unreadableRetry : t.submit}
          </Button>
        )}
      </form>

      {showCamera ? (
        <CameraCaptureModal
          dict={dict}
          onCapture={(f) => handlePicked(f)}
          onClose={() => setShowCamera(false)}
        />
      ) : null}
    </div>
  );
}
