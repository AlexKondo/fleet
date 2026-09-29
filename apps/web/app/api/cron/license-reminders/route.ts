import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

const THRESHOLDS = [
  { days: 180, column: "license_reminder_6mo_sent_at" as const, months: 6 },
  { days: 90, column: "license_reminder_3mo_sent_at" as const, months: 3 },
  { days: 30, column: "license_reminder_1mo_sent_at" as const, months: 1 },
];

/**
 * Runs daily (vercel.json cron -> this route). For every profile with a license
 * expiration date on file, sends exactly one email per threshold (180/90/30 days out) the
 * first time the countdown crosses it — the `license_reminder_<N>mo_sent_at` columns
 * (0039_license_ocr_and_reminders.sql) are what make each one fire only once instead of
 * resending every day the license stays inside that window.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: profiles, error } = await admin
    .from("profiles")
    .select(
      "id, full_name, drivers_license_expiration, license_reminder_6mo_sent_at, license_reminder_3mo_sent_at, license_reminder_1mo_sent_at",
    )
    .not("drivers_license_expiration", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const profile of profiles ?? []) {
    const expiration = new Date(`${profile.drivers_license_expiration}T00:00:00Z`);
    const daysUntil = Math.round((expiration.getTime() - today.getTime()) / DAY_MS);

    for (const threshold of THRESHOLDS) {
      const alreadySent = Boolean(
        (profile as Record<string, unknown>)[threshold.column],
      );
      if (alreadySent || daysUntil > threshold.days || daysUntil < 0) continue;

      const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (!email) continue;

      const result = await sendEmail({
        to: email,
        subject: `Sua CNH vence em ${threshold.months} ${threshold.months === 1 ? "mês" : "meses"}`,
        text: `Olá, ${profile.full_name ?? ""}.\n\nSua CNH cadastrada no Fleet vence em ${profile.drivers_license_expiration} (aproximadamente ${threshold.months} ${threshold.months === 1 ? "mês" : "meses"} a partir de hoje). Renove sua habilitação e atualize os dados em Fleet assim que possível para continuar autorizado a retirar veículos.\n\n— Fleet`,
        html: `<p>Olá, ${profile.full_name ?? ""}.</p><p>Sua CNH cadastrada no Fleet vence em <strong>${profile.drivers_license_expiration}</strong> (aproximadamente ${threshold.months} ${threshold.months === 1 ? "mês" : "meses"} a partir de hoje). Renove sua habilitação e atualize os dados no Fleet assim que possível para continuar autorizado a retirar veículos.</p><p>— Fleet</p>`,
      });

      if (result.success) {
        sent += 1;
        const now = new Date().toISOString();
        const update =
          threshold.column === "license_reminder_6mo_sent_at"
            ? { license_reminder_6mo_sent_at: now }
            : threshold.column === "license_reminder_3mo_sent_at"
              ? { license_reminder_3mo_sent_at: now }
              : { license_reminder_1mo_sent_at: now };
        await admin.from("profiles").update(update).eq("id", profile.id);
      } else {
        errors.push(`${profile.id}/${threshold.column}: ${result.error}`);
      }
    }
  }

  return NextResponse.json({ checked: profiles?.length ?? 0, sent, errors });
}
