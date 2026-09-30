import type { ChatUsageStats } from "../chat/queries";
import type { Dictionary } from "../../lib/i18n/dictionaries";
import { Card } from "../ui/Card";

/** §V5 telemetry, the simplest form that fits this app's existing Settings page instead of
 * a dedicated dashboard route — fleet_manager/administrator only, same gate as the rest of
 * this page (settings/page.tsx already redirects anyone else before this ever renders). */
export function ChatUsageSummary({ dict, stats }: { dict: Dictionary; stats: ChatUsageStats }) {
  const t = dict.settings.chatUsage;

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-fog-400">{t.title}</h2>
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-2xl font-semibold text-paper-50">{stats.conversationsLast7Days}</p>
            <p className="text-xs text-fog-400">{t.conversations7d}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-paper-50">{stats.messagesToday}</p>
            <p className="text-xs text-fog-400">{t.messagesToday}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-paper-50">{stats.resolvedCount}</p>
            <p className="text-xs text-fog-400">{t.resolved}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-paper-50">{stats.abandonedCount}</p>
            <p className="text-xs text-fog-400">{t.abandoned}</p>
          </div>
        </div>

        {stats.topIntents.length > 0 ? (
          <div className="mt-4 border-t border-line-800 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-fog-400">{t.topIntents}</p>
            <div className="flex flex-col gap-1.5">
              {stats.topIntents.map((row) => (
                <div key={row.intent} className="flex items-center justify-between text-sm">
                  <span className="text-fog-400">{row.intent}</span>
                  <span className="font-medium text-paper-50">{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
