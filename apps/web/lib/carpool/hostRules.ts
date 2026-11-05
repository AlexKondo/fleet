import type { PolicyLoad } from "./loadPolicy";

/**
 * What the host may see about a ride request, for every place that shows it (reservation, assistant). The WhatsApp notice applies the same rules in SQL
 * (0257). Unknown policy: the name stays hidden, since showing it cannot be undone.
 */
export function hostSeesRider(policy: PolicyLoad, status: string): boolean {
  if (status === "ACCEPTED") return true;
  return policy.ok && policy.policy.hostSeesRiderBeforeAccept;
}

/** The policy limits when this detour passes them, so the host is told before answering. */
export function detourOverLimit(policy: PolicyLoad, km: number | null, min: number | null): { km: number; min: number } | null {
  if (!policy.ok || km === null || min === null) return null;
  const { maxAdditionalDistanceKm, maxAdditionalTimeMinutes } = policy.policy;
  return km > maxAdditionalDistanceKm || min > maxAdditionalTimeMinutes ? { km: maxAdditionalDistanceKm, min: maxAdditionalTimeMinutes } : null;
}
