-- 005_assignee_all_and_member_lookup.sql
-- タスク担当者に「全員」を選べるようにする列と、招待前のDiscordユーザーをID指定で
-- 参照できる公開ルックアップ関数を追加する。

alter table public.tasks add column if not exists assigned_to_all boolean not null default false;

create index if not exists profiles_discord_user_id_idx on public.profiles(discord_user_id);

-- 招待フォームでDiscord User IDを入力した時点で、まだ同じグループに所属していない
-- 相手でも表示名/アイコンをプレビューできるようにする最小限の公開ルックアップ。
-- profilesテーブル本体のRLS（自分/同グループのみ閲覧可）は変更せず、必要な3列だけを返す。
create or replace function public.lookup_profile_by_discord_id(discord_id text)
returns table(display_name text, avatar_url text, discord_username text)
language sql security definer stable set search_path = public as $$
  select display_name, avatar_url, discord_username
  from public.profiles
  where discord_user_id = discord_id
  limit 1
$$;
grant execute on function public.lookup_profile_by_discord_id(text) to authenticated;

-- task_summaryはt.*を含むため、assigned_to_all追加に合わせて作り直す
-- (CREATE OR REPLACE VIEWは列の並び順を変更できないためDROP+CREATEを使う)
drop view if exists public.task_summary;

create view public.task_summary
with (security_invoker = true) as
select
  t.*,
  p.display_name as assignee_display_name,
  p.avatar_url as assignee_avatar_url,
  coalesce(c.cnt, 0) as comment_count,
  coalesce(l.cnt, 0) as link_count,
  coalesce(a.cnt, 0) as attachment_count
from public.tasks t
left join public.profiles p on p.id = t.assigned_to
left join (select task_id, count(*) cnt from public.task_comments group by task_id) c on c.task_id = t.id
left join (select task_id, count(*) cnt from public.task_links group by task_id) l on l.task_id = t.id
left join (select task_id, count(*) cnt from public.task_attachments group by task_id) a on a.task_id = t.id;

grant select on public.task_summary to authenticated;
