"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

/**
 * Live in-browser camera via getUserMedia — `<input capture>` only opens a device camera
 * on mobile browsers; desktop browsers (Chrome/Edge/Firefox on Windows/Mac/Linux) just
 * ignore that attribute and fall back to a plain file picker. This modal works the same
 * way everywhere: a live video preview, a shutter button that grabs the current frame via
 * <canvas> and hands it back as a File.
 */
export function CameraCaptureModal({
  dict,
  onCapture,
  onClose,
}: {
  dict: Dictionary;
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const t = dict.reservations.photos;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"opening" | "ready" | "error">("opening");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function open() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setErrorMessage(
          name === "NotAllowedError" || name === "SecurityError"
            ? t.cameraPermissionDenied
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? t.cameraNotFound
              : t.cameraGenericError,
        );
        setStatus("error");
      }
    }
    open();

    return () => {
      cancelled = true;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, [t]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-md border border-line-800 bg-panel-900 p-4">
        <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-sm bg-black">
          {status === "opening" ? (
            <p className="text-sm text-fog-400">{t.openingCamera}</p>
          ) : status === "error" ? (
            <p className="px-6 text-center text-sm text-signal-red">{errorMessage}</p>
          ) : null}
          {/* Always mounted (not conditionally rendered) so the ref exists before the
              getUserMedia promise resolves; hidden visually until ready. */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={`h-full w-full object-cover ${status === "ready" ? "" : "hidden"}`}
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-line-700 px-4 py-2 text-sm text-fog-400 hover:border-line-600 hover:text-paper-50"
          >
            {dict.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleShutter}
            disabled={status !== "ready"}
            className="rounded-sm bg-gwm-accent px-4 py-2 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.takePhoto}
          </button>
        </div>
      </div>
    </div>
  );
}
