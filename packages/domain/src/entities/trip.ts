export interface TripRequest {
  id: string;
  organizationId: string;
  requesterId: string;
  /** ISO 8601 */
  departureAt: string;
  /** ISO 8601 */
  expectedReturnAt: string;
  origin: string;
  destination: string;
  /** Distância total estimada da viagem (ida + volta), em km. */
  distanceKm: number;
  passengerCount: number;
  requiresCargo: boolean;
  justification: string;
  /** Whether the requester consented, at booking time, to sharing this vehicle with other
   * travelers headed the same way (findCarpoolMatches checks this on the EXISTING/host
   * trip when evaluating a new request as a candidate to join). Optional — undefined
   * (e.g. older records, or a caller that doesn't care) is treated the same as true, so
   * this only ever narrows matches, never silently breaks a caller that never set it. */
  allowCarpool?: boolean;
}
