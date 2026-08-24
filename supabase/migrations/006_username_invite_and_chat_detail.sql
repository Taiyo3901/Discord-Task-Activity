-- 006_username_invite_and_chat_detail.sql
-- 1) Discordユーザーネームでの招待用ルックアップ（一度でもログインした相手のみ解決可能）
-- 2) タスク詳細を「発言者ごとに1行、他人の行は編集不可」なチャット形式に変更

-- ============================================================
-- 1. ユーザーネームでの招待ルックアップ
-- ============================================================

create index if not exists profiles_discord_username_lower_idx on public.profiles (lower(discord_username));

create or replace function public.lookup_profile_by_username(username text)
returns table(discord_user_id text, display_name text, avatar_url text, discord_username text)
language sql security definer stable set search_path = public as $$
  select discord_user_id, display_name, avatar_url, discord_username
  from public.profiles
  where lower(discord_username) = lower(username)
  limit 1
$$;
grant execute on function public.lookup_profile_by_username(text) to authenticated;

-- ============================================================
-- 2. タスク詳細のチャット化: task_page_blocks
-- ============================================================

create table public.task_page_blocks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_page_blocks_task_idx on public.task_page_blocks(task_id, created_at);

alter table public.task_page_blocks enable row level security;

create policy task_page_blocks_read on public.task_page_blocks for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))
);
create policy task_page_blocks_insert on public.task_page_blocks for insert to authenticated with check (
  author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
);
-- 更新・削除は「自分が書いた行」のみ許可。他人の行には一切書き込めない。
create policy task_page_blocks_update on public.task_page_blocks for update to authenticated using (
  author_id = auth.uid()
) with check (
  author_id = auth.uid()
);
create policy task_page_blocks_delete on public.task_page_blocks for delete to authenticated using (
  author_id = auth.uid() or exists (select 1 from public.tasks t where t.id = task_id and public.is_group_admin(t.group_id))
);

create trigger task_page_blocks_touch before update on public.task_page_blocks
  for each row execute function public.touch_updated_at();

-- 既存のtask_pages本文を、1行分のブロックとして引き継ぐ（データを失わないため）。
-- task_pages自体は削除しない（フロントは今後task_page_blocksのみを使う）。
insert into public.task_page_blocks (task_id, author_id, content, created_at, updated_at)
select tp.task_id, coalesce(tp.updated_by, t.created_by), tp.content, tp.updated_at, tp.updated_at
from public.task_pages tp
join public.tasks t on t.id = tp.task_id
where tp.content is not null and length(trim(tp.content)) > 0;
