/**
 * Minimal in-memory stand-in for the Supabase query builder, used by the chat/carpool unit tests.
 * It really applies `.eq` / `.in` filters (including dotted paths into embedded rows such as
 * "trip_request.requester_id") so tests can prove that ownership scoping is done by the code
 * under test (foreign rows are present in the fixtures and must NOT be reachable).
 */
import { vi } from "vitest";

export type Rows = Record<string, Record<string, unknown>[]>;

const get = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null | undefined)?.[k], obj);

export function fakeSupabase(rows: Rows) {
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  const updated: { table: string; patch: Record<string, unknown> }[] = [];

  function from(table: string) {
    let data = [...(rows[table] ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q,
      eq: (col: string, value: unknown) => {
        data = data.filter((r) => get(r, col) === value);
        return q;
      },
      in: (col: string, values: unknown[]) => {
        data = data.filter((r) => values.includes(get(r, col)));
        return q;
      },
      gte: () => q,
      gt: () => q,
      lt: () => q,
      not: () => q,
      order: () => q,
      limit: () => q,
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        data = [{ id: `${table}-new`, ...row }];
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        updated.push({ table, patch });
        return q;
      },
      maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
      single: async () => ({ data: data[0] ?? null, error: data[0] ? null : { message: "not found" } }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data, error: null, count: data.length }),
    };
    return q;
  }

  return { from, rpc: vi.fn(), inserted, updated };
}
