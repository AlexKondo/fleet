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
}
