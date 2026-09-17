/**
 * Shared empty state for the three fleet tabs. Replaces a bare `<p>` of grey text with
 * the same shape the dashboard's vehicle empty state uses: one line saying what is
 * missing, plus a hint pointing at the "+ Adicionar …" affordance that already sits
 * directly below it. Icon-free on purpose — this app doesn't use decorative icons.
 */
export function EmptyState({ lead, hint }: { lead: string; hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-line-800 px-6 py-8 text-center">
      <p className="text-sm text-paper-50">{lead}</p>
      <p className="mt-1 text-xs text-fog-400">{hint}</p>
    </div>
  );
}
