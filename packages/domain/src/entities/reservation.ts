export type ReservationStatus = "pending_approval" | "confirmed" | "cancelled" | "completed";

export interface ReservationWindow {
  /** ISO 8601 */
  startAt: string;
  /** ISO 8601 */
  endAt: string;
}

export interface Reservation extends ReservationWindow {
  id: string;
  organizationId: string;
  vehicleId: string;
  tripRequestId: string;
  status: ReservationStatus;
}
