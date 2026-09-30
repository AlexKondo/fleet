-- Voice & Conversational UX pack (apps/web/app/chat/*) — stores conversation turns so the
-- orchestrator (chatOrchestrator.ts) has multi-turn context. Persisted rather than kept
-- in-memory because Next.js server actions run in stateless serverless invocations with no
-- shared memory between requests — a DB row is the only place state can actually live
-- between turns. No raw audio is ever stored (the browser's Web Speech API transcribes
-- client-side; only the resulting text ever reaches the server).

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'resolved', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  intent text,
  slots jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_conversation_id_idx on public.chat_messages (conversation_id, created_at);
create index chat_conversations_user_id_idx on public.chat_conversations (user_id, updated_at desc);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

-- A user can only ever see/write their own conversations — this is a personal assistant
-- thread, not a shared/team-visible surface (unlike reservation messages).
create policy "Users can view their own conversations"
  on public.chat_conversations for select
  using (user_id = auth.uid());

create policy "Users can create their own conversations"
  on public.chat_conversations for insert
  with check (user_id = auth.uid());

create policy "Users can update their own conversations"
  on public.chat_conversations for update
  using (user_id = auth.uid());

create policy "Users can view messages in their own conversations"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users can add messages to their own conversations"
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id and c.user_id = auth.uid()
    )
  );
