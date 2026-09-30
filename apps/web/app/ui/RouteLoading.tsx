/**
 * Shared route-level loading skeleton (used by every loading.tsx). Deliberately text-free:
 * a loading.tsx is the Suspense fallback and can't await getDictionary(), so a localized
 * string would have to be hardcoded in one language. Flat bars, 1px borders, no shadow and
 * no gradient — same visual rules as Card.tsx (gwm-design §1.5).
 *
 * Deliberately shape-agnostic (a handful of plain full-width bars), not a card grid — it
 * used to be a fixed 3-column vehicle-card grid, which matched dashboard/fleet but looked
 * wrong borrowed by anything else. A route with no loading.tsx of its own inherits its
 * nearest ANCESTOR's Suspense boundary (e.g. /trips/new had none, so navigating to it
 * showed /trips's skeleton — a card grid for what's actually a form, and stale on top of
 * that since /trips itself moved to the Gantt view and no longer looks like this either).
 * Bars read reasonably as a stand-in for a form, a table, a list or a grid alike, so this
 * one skeleton works regardless of which page ends up borrowing it.
 */
export function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse px-6 py-6">
      <div className="h-4 w-40 rounded-sm bg-panel-800" />
      <div className="mt-5 flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-md border border-line-800 bg-panel-900/60" />
        ))}
      </div>
    </div>
  );
}
