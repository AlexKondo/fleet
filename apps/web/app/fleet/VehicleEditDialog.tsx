"use client";

import { createContext, useContext, useEffect, useId, useRef } from "react";

/** The edit popup exposes `close` to the form inside it (VehicleRow closes it after a successful save / on cancel). */
const VehicleDialogContext = createContext<{ close: () => void }>({ close: () => {} });
export const useVehicleDialog = () => useContext(VehicleDialogContext);

/**
 * Edit popup shown IN FRONT of the vehicle list (native <dialog> opened with showModal: focus is trapped inside, Esc closes,
 * the page behind is inert). Clicking the dark backdrop closes it too. Mounted only while a vehicle is being edited.
 */
export function VehicleEditDialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <VehicleDialogContext.Provider value={{ close: onClose }}>
      <dialog
        ref={ref}
        className="vw-dialog"
        aria-labelledby={titleId}
        data-testid="vehicle-edit-dialog"
        onClose={onClose}
        onClick={(e) => {
          if (e.target === ref.current) onClose();
        }}
      >
        <div className="vw-dialog-panel">
          <header className="vw-dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="vw-dialog-close" onClick={onClose} aria-label={closeLabel}>
              ×
            </button>
          </header>
          <div className="vw-dialog-body">{children}</div>
        </div>
      </dialog>
    </VehicleDialogContext.Provider>
  );
}

export function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" width={16} height={16}>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 7.5 3 3" />
    </svg>
  );
}
