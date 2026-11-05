import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { formatDayMonthTime } from "@/lib/formatDateTime";
import { getAreaText } from "@/lib/i18n/areaText";
import { incidentsTexts } from "@/lib/i18n/areas/incidents";
import type { Locale } from "@/lib/i18n/locales";
import { checklistReportItems, hasChecklistReport } from "@/lib/operations/checklistReports";

/**
 * What was already reported on this reservation's checklists, on the porter's departure / return screen: he sees it where he is
 * looking at the vehicle. Nothing to show, nothing rendered; a read that fails only leaves the block out (it never blocks the check).
 */
export async function ChecklistReports({ supabase, reservationId, locale }: { supabase: TypedSupabaseClient; reservationId: string; locale: Locale }) {
  const { data } = await supabase
    .from("inspections")
    .select("id, type, performed_by_role, has_new_damage, damage_notes, missing_safety_equipment, is_dirty_exterior, is_dirty_interior, created_at")
    .eq("reservation_id", reservationId)
    .order("created_at");
  const reports = (data ?? []).filter(hasChecklistReport);
  if (reports.length === 0) return null;

  const T = await getAreaText(incidentsTexts);
  const labels = { damage: T.typeDamage, equipment: T.typeEquipment, cleaning: T.typeCleaning, exterior: T.exterior, interior: T.interior };
  return (
    <section className="fm-card ck-card ck-reports" data-testid="checklist-reports">
      <h2 className="fm-h2">{T.checklistReportsTitle}</h2>
      <ul>
        {reports.map((r) => (
          <li key={r.id}>
            <small>
              {r.type === "pickup" ? T.pickup : T.returnTrip} · {r.performed_by_role === "security" ? T.security : T.employee} ·{" "}
              {formatDayMonthTime(r.created_at, locale)}
            </small>
            {checklistReportItems(r, labels).map((item) => (
              <p key={item} className="break-user-text">
                {item}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
