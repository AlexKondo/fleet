/** Only public business codes may cross the dashboard redirect boundary. */
const PUBLIC_ERRORS = ['DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED', 'RESERVATION_EXPIRED'] as const;
export function knownFleetActionError(message: string | undefined): typeof PUBLIC_ERRORS[number] | null {
  return PUBLIC_ERRORS.find(code => message?.includes(code)) ?? null;
}
