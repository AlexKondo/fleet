/** The order to show: what the person arranged, then any card that is new to them. Saved ids of cards not on screen are ignored here, not lost. */
export function mergeCardOrder(saved: readonly unknown[], ids: readonly string[]): string[] {
  const known = new Set(ids);
  const kept = [...new Set(saved.filter((id): id is string => typeof id === "string" && known.has(id)))];
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

/** The dragged card takes the place of the one it was dropped on. */
export function moveCard(order: readonly string[], from: string, to: string): string[] {
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (from === to || fromIndex < 0 || toIndex < 0) return [...order];
  const next = order.filter((id) => id !== from);
  next.splice(toIndex, 0, from);
  return next;
}

/** What to store: the new order, keeping the position of the cards a filter is hiding right now. */
export function orderToSave(next: readonly string[], saved: readonly unknown[]): string[] {
  const hidden = saved.filter((id): id is string => typeof id === "string" && !next.includes(id));
  return [...next, ...hidden];
}
