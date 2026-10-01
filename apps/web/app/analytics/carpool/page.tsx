import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getDictionary } from "@/lib/i18n/getLocale";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadCarpoolKpis } from "@/lib/carpool/kpi/loadKpis";
import { KPI_RANGE_DAYS, ROAD_DISTANCE_FACTOR } from "@/lib/carpool/kpi/config";
import { AppShell } from "../../AppShell";
import { StatBar } from "../StatBar";
import { Card } from "../../ui/Card";

/**
 * C7b KPI / telemetry dashboard for the carpool engine (pack 06 "Observability/KPIs"). Same family as the
 * Settings chat-usage summary: number cards + simple tables/bars, no charting dependency. fleet_manager and
 * administrator only (anyone else is redirected). The data function uses the service-role client AFTER the
 * caller's role and organization are verified from their own session; only aggregated numbers reach the page.
 * Definitions and the estimate parameters are documented in lib/carpool/kpi/aggregate.ts and config.ts.
 */
export default async function CarpoolKpiPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const t = dict.carpoolKpi;
  const supabase = await createSupabaseServerClient();

  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, organization_id, organization:organizations(name)")
    .eq("id", user.id)
    .single();
  const isFleetManager = profile?.role === "fleet_manager" || profile?.role === "administrator";
  if (!profile || !isFleetManager) redirect("/dashboard");

  const { range } = await searchParams;
  const requested = Number(range);
  const days = (KPI_RANGE_DAYS as readonly number[]).includes(requested) ? requested : 30;

  let report: Awaited<ReturnType<typeof loadCarpoolKpis>> | null = null;
  try {
    report = await loadCarpoolKpis(createSupabaseAdminClient(), profile.organization_id, days);
  } catch {
    report = null;
  }

  const num = (n: number) => n.toLocaleString(locale);
  const dec = (n: number, d = 1) => n.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const ms = (n: number | null) => (n === null ? "—" : `${num(n)} ms`);
  const providerLabel: Record<string, string> = {
    geocode: t.providerGeocode,
    place_search: t.providerPlaceSearch,
    routing: t.providerRouting,
  };

  const Metric = ({ label, value, testId }: { label: string; value: string; testId: string }) => (
    <div data-testid={testId}>
      <p className="text-2xl font-semibold tabular-nums text-paper-50" data-value={value}>{value}</p>
      <p className="text-xs text-fog-400">{label}</p>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mb-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fog-400">{title}</h2>
      <Card>{children}</Card>
    </section>
  );

  return (
    <AppShell
      active="analytics"
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      role={profile.role}
      isFleetManager
      isAdministrator={profile.role === "administrator"}
      title={t.title}
      headerActions={
        <Link href="/analytics" className="text-xs uppercase tracking-widest text-fog-400 hover:text-paper-50">
          {t.backToAnalytics}
        </Link>
      }
    >
      <div className="px-6 py-6" data-testid="carpool-kpi-page">
        <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label={t.rangeLabel}>
          <span className="text-xs uppercase tracking-widest text-fog-600">{t.rangeLabel}</span>
          {KPI_RANGE_DAYS.map((d) => (
            <Link
              key={d}
              href={`/analytics/carpool?range=${d}`}
              data-testid={`kpi-range-${d}`}
              aria-current={d === days ? "true" : undefined}
              className={`rounded-sm border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${
                d === days
                  ? "border-gwm-accent bg-gwm-accent/10 text-gwm-accent"
                  : "border-line-800 text-fog-400 hover:border-line-700 hover:text-paper-50"
              }`}
            >
              {d === 7 ? t.range7 : d === 30 ? t.range30 : t.range90}
            </Link>
          ))}
        </div>

        {report === null ? (
          <div role="alert" className="rounded-md border border-signal-red/40 bg-signal-red/10 px-4 py-3 text-sm text-signal-red">
            {t.loadError}
          </div>
        ) : (
          <>
            <Section title={t.sectionSearch}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Metric testId="kpi-trips-evaluated" label={t.tripsEvaluated} value={num(report.search.searches)} />
                <Metric testId="kpi-offers-evaluated" label={t.offersEvaluated} value={num(report.search.offersEvaluated)} />
                <Metric testId="kpi-prefilter" label={t.candidatesAfterPrefilter} value={num(report.search.prefilterCandidates)} />
                <Metric testId="kpi-precise-calls" label={t.preciseRouteCalls} value={num(report.search.preciseRouteCalls)} />
                <Metric testId="kpi-compatible" label={t.compatibleMatches} value={num(report.search.compatibleMatches)} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line-800 pt-4 sm:grid-cols-4">
                <Metric testId="kpi-outcome-matches" label={t.outcomeMatches} value={num(report.search.outcomes.matches)} />
                <Metric testId="kpi-outcome-none" label={t.outcomeNone} value={num(report.search.outcomes.none)} />
                <Metric testId="kpi-outcome-unavailable" label={t.outcomeUnavailable} value={num(report.search.outcomes.unavailable)} />
                <Metric testId="kpi-outcome-error" label={t.outcomeError} value={num(report.search.outcomes.error)} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line-800 pt-4 sm:grid-cols-4">
                <Metric testId="kpi-source-web" label={t.sourceWeb} value={num(report.search.bySource.web)} />
                <Metric testId="kpi-source-chat" label={t.sourceChat} value={num(report.search.bySource.chat)} />
                <Metric testId="kpi-latency-avg" label={t.latencyAvg} value={ms(report.search.latencyAvgMs)} />
                <Metric testId="kpi-latency-p95" label={t.latencyP95} value={ms(report.search.latencyP95Ms)} />
              </div>
              <div className="mt-4 border-t border-line-800 pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-widest text-fog-400">{t.searchesPerDay}</p>
                {report.search.daily.length === 0 ? (
                  <p className="text-sm text-fog-600">{t.noData}</p>
                ) : (
                  <div className="flex flex-col gap-1.5" data-testid="kpi-daily">
                    {report.search.daily.map((d) => (
                      <StatBar
                        key={d.day}
                        label={d.day}
                        value={d.searches}
                        max={Math.max(...report.search.daily.map((x) => x.searches))}
                        locale={locale}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Section>

            <Section title={t.sectionOffers}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric testId="kpi-offers-enabled" label={t.offersEnabled} value={num(report.offers.enabled)} />
                <Metric testId="kpi-offers-active" label={t.offersActiveNow} value={num(report.offers.activeNow)} />
                <Metric testId="kpi-invalidations" label={t.invalidationsAfterHostChange} value={num(report.invalidations)} />
              </div>
            </Section>

            <Section title={t.sectionRequests}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric testId="kpi-requests-total" label={t.rideRequests} value={num(report.requests.total)} />
                <Metric testId="kpi-requests-accepted" label={t.accepted} value={num(report.requests.accepted)} />
                <Metric testId="kpi-requests-rejected" label={t.rejected} value={num(report.requests.rejected)} />
                <Metric testId="kpi-requests-expired" label={t.expired} value={num(report.requests.expired)} />
                <Metric testId="kpi-requests-cancelled" label={t.cancelled} value={num(report.requests.cancelled)} />
                <Metric testId="kpi-requests-pending" label={t.pending} value={num(report.requests.pending)} />
                <Metric testId="kpi-requests-invalidated" label={t.invalidatedRequests} value={num(report.requests.invalidated)} />
                <Metric
                  testId="kpi-acceptance-rate"
                  label={t.acceptanceRate}
                  value={report.requests.acceptanceRate === null ? "—" : `${dec(report.requests.acceptanceRate)}%`}
                />
              </div>
            </Section>

            <Section title={t.sectionShared}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric testId="kpi-shared-trips" label={t.completedSharedTrips} value={num(report.shared.completedSharedTrips)} />
                <Metric testId="kpi-seats-shared" label={t.seatsShared} value={num(report.shared.seatsShared)} />
                <Metric testId="kpi-avoided-allocations" label={t.avoidedAllocations} value={num(report.shared.avoidedAllocations)} />
                <Metric testId="kpi-avoided-km" label={t.avoidedKm} value={`≈ ${dec(report.shared.avoidedKmEstimate)} km`} />
              </div>
              <p className="mt-3 text-xs text-fog-600">{t.avoidedKmNote.replace("{factor}", String(ROAD_DISTANCE_FACTOR))}</p>
              {report.shared.requestsWithoutCoordinates > 0 ? (
                <p className="mt-1 text-xs text-fog-600">
                  {t.requestsWithoutCoordinates}: {num(report.shared.requestsWithoutCoordinates)}
                </p>
              ) : null}
            </Section>

            <Section title={t.sectionProvider}>
              {report.provider.byKind.length === 0 ? (
                <p className="text-sm text-fog-600">{t.noData}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-sm" data-testid="kpi-provider-table">
                    <thead>
                      <tr className="border-b border-line-800 text-left text-xs uppercase tracking-widest text-fog-600">
                        <th className="py-2 pr-4 font-medium">{t.colKind}</th>
                        <th className="py-2 pr-4 font-medium">{t.colCalls}</th>
                        <th className="py-2 pr-4 font-medium">{t.colErrors}</th>
                        <th className="py-2 pr-4 font-medium">{t.colAvgLatency}</th>
                        <th className="py-2 font-medium">{t.colEstCost}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.provider.byKind.map((k) => (
                        <tr key={k.kind} className="border-b border-line-800 last:border-0" data-testid={`kpi-provider-${k.kind}`}>
                          <td className="py-2 pr-4 text-paper-50">{providerLabel[k.kind] ?? k.kind}</td>
                          <td className="py-2 pr-4 font-mono tabular-nums">{num(k.calls)}</td>
                          <td className="py-2 pr-4 font-mono tabular-nums">{num(k.errors)}</td>
                          <td className="py-2 pr-4 font-mono tabular-nums">{k.avgLatencyMs === null ? "—" : num(k.avgLatencyMs)}</td>
                          <td className="py-2 font-mono tabular-nums">≈ {dec(k.estCostUsd, 4)}</td>
                        </tr>
                      ))}
                      <tr data-testid="kpi-provider-total">
                        <td className="py-2 pr-4 font-semibold text-paper-50">{t.totalRow}</td>
                        <td className="py-2 pr-4 font-mono tabular-nums">{num(report.provider.totalCalls)}</td>
                        <td className="py-2 pr-4 font-mono tabular-nums">{num(report.provider.totalErrors)}</td>
                        <td className="py-2 pr-4" />
                        <td className="py-2 font-mono tabular-nums">≈ {dec(report.provider.estCostUsd, 4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-fog-600">{t.costNote}</p>
            </Section>

            <Section title={t.sectionDefinitions}>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-fog-400">
                <li>{t.defSearch}</li>
                <li>{t.defRequests}</li>
                <li>{t.defShared}</li>
                <li>{t.defAvoided}</li>
                <li>{t.defProvider}</li>
              </ul>
            </Section>
          </>
        )}
      </div>
    </AppShell>
  );
}
