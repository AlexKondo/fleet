import { NextResponse, type NextRequest } from "next/server";
import { GET as licenseReminders } from "../license-reminders/route";
import { GET as chatCleanup } from "../chat-cleanup/route";
import { GET as carpoolExpiry } from "../carpool-expiry/route";

export const dynamic = "force-dynamic";

/**
 * The one cron entry registered in vercel.json. The project is on Vercel's Hobby plan, which allows
 * at most 2 cron jobs; the app has 3 daily jobs (license reminders, chat cleanup, carpool expiry),
 * so they run sequentially from this single dispatcher instead of being registered separately.
 * Each job's own route still exists (manual invocation, tests) and does its own CRON_SECRET check,
 * so the same request — Authorization header included — is forwarded to it. One job failing never
 * prevents the others from running; the dispatcher returns 500 if any failed so Vercel's cron log
 * shows it.
 */
const JOBS: ReadonlyArray<readonly [string, (request: NextRequest) => Promise<Response>]> = [
  ["license-reminders", licenseReminders],
  ["chat-cleanup", chatCleanup],
  ["carpool-expiry", carpoolExpiry],
];

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  // Fail closed, same as every cron route (middleware exempts /api/cron/ from the session check).
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, { status: number; body: unknown }> = {};
  for (const [name, job] of JOBS) {
    try {
      const response = await job(request);
      results[name] = { status: response.status, body: await response.json().catch(() => null) };
    } catch (error) {
      results[name] = {
        status: 500,
        body: { error: error instanceof Error ? error.message : "job_failed" },
      };
    }
  }

  const anyFailed = Object.values(results).some((result) => result.status >= 400);
  return NextResponse.json(results, { status: anyFailed ? 500 : 200 });
}
