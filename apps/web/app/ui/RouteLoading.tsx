/**
 * Shared route-level loading skeleton (used by every loading.tsx). Deliberately text-free:
 * a loading.tsx is the Suspense fallback and can't await getDictionary(), so a localized
 * string would have to be hardcoded in one language. Flat bars, 1px borders, no shadow and
 * no gradient — same visual rules as Card.tsx (gwm-design §1.5).
 */
export function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse px-6 py-6">
      <div className="h-4 w-40 rounded-sm bg-panel-800" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-md border border-line-800 bg-panel-900/60 p-4">
            <div className="h-3 w-24 rounded-sm bg-panel-800" />
            <div className="mt-3 h-3 w-16 rounded-sm bg-panel-800" />
            <div className="mt-6 h-3 w-full rounded-sm bg-panel-800" />
            <div className="mt-2 h-3 w-2/3 rounded-sm bg-panel-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
