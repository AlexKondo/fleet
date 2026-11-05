/** What a checklist flagged: damage, missing safety equipment or dirt. */
export interface ChecklistFlags {
  has_new_damage: boolean | null;
  missing_safety_equipment: string[] | null;
  is_dirty_exterior: boolean | null;
  is_dirty_interior: boolean | null;
}

export function hasChecklistReport(i: ChecklistFlags): boolean {
  return Boolean(i.has_new_damage || (i.missing_safety_equipment?.length ?? 0) || i.is_dirty_exterior || i.is_dirty_interior);
}

/** The flags in words, one item per kind of report. */
export function checklistReportItems(
  i: ChecklistFlags & { damage_notes: string | null },
  labels: { damage: string; equipment: string; cleaning: string; exterior: string; interior: string },
): string[] {
  const items: string[] = [];
  if (i.has_new_damage) items.push(i.damage_notes?.trim() ? `${labels.damage}: ${i.damage_notes.trim()}` : labels.damage);
  if (i.missing_safety_equipment?.length) items.push(`${labels.equipment}: ${i.missing_safety_equipment.join(", ")}`);
  const dirty = [i.is_dirty_exterior ? labels.exterior : null, i.is_dirty_interior ? labels.interior : null].filter(Boolean);
  if (dirty.length) items.push(`${labels.cleaning}: ${dirty.join(" / ")}`);
  return items;
}
