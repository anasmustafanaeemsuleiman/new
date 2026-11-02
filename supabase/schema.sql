-- ===========================================================================
-- Chatter — Supabase schema
--
-- Run this once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- The script is idempotent, so re-running it is safe.
-- ===========================================================================

-- 1. Profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '',
  about text not null default 'Hey there! I am using Chatter.',
  color text not null default '#00a884',
  created_at timestamptz not null default now()
);

-- 2. Chats, members, messages ----------------------------------------------
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct',
  created_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_created_idx
  on public.messages (chat_id, created_at desc);
create index if not exists chat_members_user_idx
  on public.chat_members (user_id);

-- 3. Every new auth user gets a profile row --------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
begin
  requested := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));

  if requested !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Invalid username';
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    requested,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), requested)
  );

  return new;
end;
$$;

revoke all on function public.handle_new_user() from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Membership check used by the RLS policies -----------------------------
-- SECURITY DEFINER so the chat_members policy does not call itself recursively.
create or replace function public.is_chat_member(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_members
    where chat_id = p_chat and user_id = auth.uid()
  );
$$;

-- 5. Open (or create) the 1-to-1 chat with another user --------------------
create or replace function public.start_direct_chat(p_peer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  found_chat uuid;
begin
  if me is null then
    raise exception 'You must be signed in';
  end if;
  if p_peer = me then
    raise exception 'You cannot start a chat with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_peer) then
    raise exception 'That user does not exist';
  end if;

  select m1.chat_id into found_chat
  from public.chat_members m1
  join public.chat_members m2 on m2.chat_id = m1.chat_id
  join public.chats c on c.id = m1.chat_id
  where c.kind = 'direct'
    and m1.user_id = me
    and m2.user_id = p_peer
  limit 1;

  if found_chat is not null then
    return found_chat;
  end if;

  insert into public.chats (kind) values ('direct')
  returning id into found_chat;

  insert into public.chat_members (chat_id, user_id)
  values (found_chat, me), (found_chat, p_peer);

  return found_chat;
end;
$$;

-- 5b. Chat with yourself (WhatsApp-style "notes to self") --------------
create or replace function public.start_self_chat()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  found_chat uuid;
begin
  if me is null then
    raise exception 'You must be signed in';
  end if;

  select cm.chat_id into found_chat
  from public.chat_members cm
  join public.chats c on c.id = cm.chat_id
  where c.kind = 'self' and cm.user_id = me
  limit 1;

  if found_chat is not null then
    return found_chat;
  end if;

  insert into public.chats (kind) values ('self')
  returning id into found_chat;

  insert into public.chat_members (chat_id, user_id)
  values (found_chat, me);

  return found_chat;
end;
$$;

-- 6. Row level security ----------------------------------------------------
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

-- Profiles are discoverable by username (that is the whole point of the app),
-- but only the owner can edit their row.
drop policy if exists "profiles are discoverable" on public.profiles;
create policy "profiles are discoverable"
  on public.profiles for select
  using (true);

drop policy if exists "own profile is editable" on public.profiles;
create policy "own profile is editable"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "members read their chats" on public.chats;
create policy "members read their chats"
  on public.chats for select
  using (public.is_chat_member(id));

drop policy if exists "members read chat members" on public.chat_members;
create policy "members read chat members"
  on public.chat_members for select
  using (public.is_chat_member(chat_id));

drop policy if exists "members update their own row" on public.chat_members;
create policy "members update their own row"
  on public.chat_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
  on public.messages for select
  using (public.is_chat_member(chat_id));

drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
  on public.messages for insert
  with check (sender_id = auth.uid() and public.is_chat_member(chat_id));

-- 7. Grants ----------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon;
grant select, update on public.profiles to authenticated;
grant select on public.chats to authenticated;
grant select, update on public.chat_members to authenticated;
grant select, insert on public.messages to authenticated;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.start_direct_chat(uuid) to authenticated;
grant execute on function public.start_self_chat() to authenticated;

-- 8. Realtime --------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chat_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chats;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
