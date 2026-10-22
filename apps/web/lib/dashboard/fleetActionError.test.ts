import {expect,it} from 'vitest';
import {knownFleetActionError} from './fleetActionError';
it.each(['RESERVATION_EXPIRED','DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED'] as const)('returns only the allowlisted code %s',code=>{
 expect(knownFleetActionError(`database private details: ${code}`)).toBe(code);
});
it.each([undefined,'SQL private internal details'])('does not expose unrecognized errors %s',message=>{
 expect(knownFleetActionError(message)).toBeNull();
});
