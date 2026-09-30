import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

export const dynamic = "force-dynamic";

/**
 * Marks a chat conversation abandoned when the user cancels a pending confirmation from
 * ChatPanel.tsx. Deliberately a plain Route Handler, not a Server Action — invoking a
 * Server Action (even called imperatively, not via a real form submit) makes Next.js
 * revalidate/refetch the current route's RSC payload, which on /trips or /dashboard
 * visibly flashed the Gantt/table underneath for no reason (cancelling has nothing to
 * refresh). A Route Handler is a plain HTTP call with no such side effect.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { conversationId } = await request.json().catch(() => ({ conversationId: null }));
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "missing_conversation_id" }, { status: 400 });
  }

  // RLS-scoped client (not the admin client) — only the conversation's own owner can
  // abandon it, same as every other user-facing chat mutation in this app.
  await supabase
    .from("chat_conversations")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
