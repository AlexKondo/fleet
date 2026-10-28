import { AsyncLocalStorage } from "node:async_hooks";
import type { TypedSupabaseClient } from "@fleet/supabase-client";

/**
 * "Act as this person" for code that normally reads the browser session (cookies / middleware headers): the WhatsApp channel runs the
 * SAME assistant as the web chat for a member identified by their registered phone number.
 *
 * Inside `runAsUser` (and only inside it - AsyncLocalStorage never leaks to another request) createSupabaseServerClient() returns the
 * given client, which carries that member's own access token, so every query and RPC runs under their RLS and permissions exactly like in
 * the browser; getCurrentUser() returns that member. Outside, nothing changes.
 */
export interface ActingContext {
  user: { id: string; email: string | null };
  client: TypedSupabaseClient;
}

const store = new AsyncLocalStorage<ActingContext>();

export const getActingContext = (): ActingContext | undefined => store.getStore();

export function runAsUser<T>(ctx: ActingContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}
