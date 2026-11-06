import type { Custodian, Unit } from "./keyCustody";

/** The units a person can be assigned to: not the disabled ones, and not the ones whose place was deactivated. */
export function selectableUnits(units: readonly Unit[], activePointIds: ReadonlySet<string>): Unit[] {
  return units.filter((u) => u.enabled && (!u.mobility_point_id || activePointIds.has(u.mobility_point_id)));
}

/** What the save of a person's custody has to change, unit by unit. Units that were not on the screen are left alone. */
export function custodyChanges(
  assignments: readonly Custodian[],
  userId: string,
  offered: readonly string[],
  chosen: ReadonlySet<string>,
): { unit_id: string; enabled: boolean; version: number }[] {
  return offered.flatMap((unitId) => {
    const current = assignments.find((a) => a.unit_id === unitId && a.user_id === userId);
    const enabled = chosen.has(unitId);
    return (current?.enabled ?? false) === enabled ? [] : [{ unit_id: unitId, enabled, version: current?.version ?? 0 }];
  });
}
