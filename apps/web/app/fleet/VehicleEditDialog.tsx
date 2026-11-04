"use client";

import { createContext, useContext, useEffect, useId, useRef } from "react";

/** The edit panel exposes `close` to the form inside it (VehicleRow closes it after a successful save / on cancel). */
const VehicleDialogContext = createContext<{ close: () => void }>({ close: () => {} });
export const useVehicleDialog = () => useContext(VehicleDialogContext);

/**
 * Edit panel opened right under the vehicle's row (the same way "+ Adicionar veiculo" opens its form below): no popup.
 * Mounted only while that vehicle is being edited; it scrolls into view when it opens.
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
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);

  return (
    <VehicleDialogContext.Provider value={{ close: onClose }}>
      <section ref={ref} className="vw-inline-edit" aria-labelledby={titleId} data-testid="vehicle-edit-panel">
        <header className="vw-inline-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="vw-dialog-close" onClick={onClose} aria-label={closeLabel}>
            ×
          </button>
        </header>
        <div>{children}</div>
      </section>
    </VehicleDialogContext.Provider>
  );
}

export function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" width={16} height={16}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
