import type { ReservationWindow } from "../entities/reservation";

export class DoubleBookingError extends Error {
  constructor(candidate: ReservationWindow) {
    super(
      `Vehicle is already reserved for an overlapping window (requested ${candidate.startAt} - ${candidate.endAt}).`,
    );
    this.name = "DoubleBookingError";
  }
}

/**
 * Two windows conflict when they overlap in time. Adjacent windows (one ends exactly
 * when the other starts) are allowed, matching typical fleet handover semantics.
 */
export function hasSchedulingConflict(
  existing: ReservationWindow[],
  candidate: ReservationWindow,
): boolean {
  const candidateStart = new Date(candidate.startAt).getTime();
  const candidateEnd = new Date(candidate.endAt).getTime();

  return existing.some((window) => {
    const start = new Date(window.startAt).getTime();
    const end = new Date(window.endAt).getTime();
    return candidateStart < end && start < candidateEnd;
  });
}

/**
 * Domain guard against double booking. Callers must pass only the vehicle's currently
 * active reservations (confirmed / pending_approval), not cancelled ones.
 */
export function reserveVehicle(
  existingActiveReservations: ReservationWindow[],
  candidate: ReservationWindow,
): void {
  if (hasSchedulingConflict(existingActiveReservations, candidate)) {
    throw new DoubleBookingError(candidate);
  }
}
