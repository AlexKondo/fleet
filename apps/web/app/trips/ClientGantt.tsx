"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { ReservationGantt } from "../ReservationGantt";

const subscribe = () => () => {};

/**
 * ReservationGantt positions the "now" marker and bar icons from Date.now(), which differs
 * between the server render and hydration (React hydration-mismatch warning on /trips).
 * Rendering it only after hydration keeps server and client markup identical.
 */
export function ClientGantt(props: ComponentProps<typeof ReservationGantt>) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return <div aria-hidden="true" style={{ minHeight: 320 }} />;
  return <ReservationGantt {...props} />;
}
