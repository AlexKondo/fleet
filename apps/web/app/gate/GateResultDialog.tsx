"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * The answer to what the porter just confirmed (released / received / refused a vehicle, or why it could not be done), as a small popup over the list.
 * Closing it takes the result out of the address, so a reload does not show it again.
 */
export function GateResultDialog({ tone, title, message, okLabel }: { tone: "ok" | "error"; title: string; message: string; okLabel: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const close = () => {
    ref.current?.close();
    router.replace("/gate");
  };
  return (
    <dialog ref={ref} className="gt-result" data-tone={tone} data-testid="gate-result" onClose={() => router.replace("/gate")} aria-labelledby="gt-result-title">
      <h2 id="gt-result-title">{tone === "ok" ? "✅" : "⚠️"} {title}</h2>
      <p>{message}</p>
      <button type="button" className="fm-btn fm-btn-primary" onClick={close} autoFocus>{okLabel}</button>
    </dialog>
  );
}
