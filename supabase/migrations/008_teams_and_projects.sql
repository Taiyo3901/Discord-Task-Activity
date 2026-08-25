-- 008_teams_and_projects.sql
-- 大規模な構造変更: 「グループ」を上位の「チーム」(Discordサーバー相当、Webhook/リマインド
-- 既定値/メンバーシップを保有)と、その配下の複数「プロジェクト」(今までのgroupsテーブル、
-- タスクのみを持つ)に分割する。予定(events)はプロジェクト単位をやめてチーム単位に統合し、
-- カレンダーもチームに1つだけにする。既存データは「1グループ=1チーム+1プロジェクト」として
-- 昇格させる。

-- ============================================================
-- 1. teams / team_members
-- ============================================================

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discord_guild_id text,
  discord_webhook_url text check (discord_webhook_url is null or discord_webhook_url ~ '^https://discord(app)?\.com/api/webhooks/'),
  task_reminder_minutes integer not null default 0 check (task_reminder_minutes >= 0),
  event_reminder_minutes integer not null default 60 check (event_reminder_minutes >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  supabase_user_id uuid not null references public.profiles(id) on delete cascade,
  discord_user_id text,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  status text not null default 'active' check (status in ('active','removed')),
  joined_at timestamptz not null default now(),
  unique(team_id, supabase_user_id)
);

-- ============================================================
-- 2. 既存データの昇格: 1グループ = 1チーム + 1プロジェクト
-- ============================================================

alter table public.groups add column if not exists team_id uuid references public.teams(id) on delete cascade;

-- グループ1件ごとにチームを1つ作成し、そのIDを直接そのグループへ紐付ける
-- (name/created_atでの突き合わせのような曖昧な対応付けを避けるため、1行ずつ処理する)
do $$
declare g record; tid uuid;
begin
  for g in select * from public.groups where team_id is null loop
    insert into public.teams (name, discord_guild_id, discord_webhook_url, task_reminder_minutes, event_reminder_minutes, created_by, created_at)
    values (g.name, g.discord_guild_id, g.discord_webhook_url, g.task_reminder_minutes, g.event_reminder_minutes, g.created_by, g.created_at)
    returning id into tid;

    update public.groups set team_id = tid where id = g.id;
  end loop;
end $$;

insert into public.team_members (team_id, supabase_user_id, discord_user_id, role, status, joined_at)
select g.team_id, gm.supabase_user_id, gm.discord_user_id, gm.role, gm.status, gm.joined_at
from public.group_members gm
join public.groups g on g.id = gm.group_id;

alter table public.groups alter column team_id set not null;
alter table public.groups drop column discord_guild_id;
alter table public.groups drop column discord_webhook_url;
alter table public.groups drop column task_reminder_minutes;
alter table public.groups drop column event_reminder_minutes;

-- ============================================================
-- 3. 権限関数をチーム経由に作り直す(既存の呼び出し側は無修正で動く)
--    is_group_member/is_group_admin/is_group_editorはgroup_membersを直接
--    参照する定義(language sql)だったため、group_membersをdropする前に
--    ここで作り直して依存関係を切り離しておく必要がある。
-- ============================================================

create or replace function public.is_team_member(tid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.team_members where team_id = tid and supabase_user_id = auth.uid() and status = 'active')
$$;

create or replace function public.is_team_admin(tid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.team_members where team_id = tid and supabase_user_id = auth.uid() and status = 'active' and role in ('owner','admin'))
$$;

create or replace function public.is_team_editor(tid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.team_members where team_id = tid and supabase_user_id = auth.uid() and status = 'active' and role in ('owner','admin','member'))
$$;

create or replace function public.is_group_member(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.groups g where g.id = gid and public.is_team_member(g.team_id))
$$;

create or replace function public.is_group_admin(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.groups g where g.id = gid and public.is_team_admin(g.team_id))
$$;

create or replace function public.is_group_editor(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.groups g where g.id = gid and public.is_team_editor(g.team_id))
$$;

-- ============================================================
-- 4. invites / events をチーム単位に付け替え
-- ============================================================

-- group_idを参照している旧RLSポリシーを先に外しておく
-- (残したままだと、後段のgroup_id列DROPが依存関係エラーで失敗する)
drop policy if exists invites_read on public.invites;
drop policy if exists invites_insert on public.invites;
drop policy if exists invites_update on public.invites;
drop policy if exists invites_delete on public.invites;
drop policy if exists events_read on public.events;
drop policy if exists events_write on public.events;
drop policy if exists events_update on public.events;
drop policy if exists events_delete on public.events;
drop policy if exists events_all on public.events;

alter table public.invites add column if not exists team_id uuid references public.teams(id) on delete cascade;
update public.invites i set team_id = g.team_id from public.groups g where g.id = i.group_id;
alter table public.invites alter column team_id set not null;
alter table public.invites drop column group_id;

alter table public.events add column if not exists team_id uuid references public.teams(id) on delete cascade;
update public.events e set team_id = g.team_id from public.groups g where g.id = e.group_id;
alter table public.events alter column team_id set not null;
alter table public.events drop column group_id;

-- profiles_readもgroup_membersに依存しているため、team_members基準に作り直してから
-- group_membersをdropする(「自分自身」または「同じチームに所属する相手」のみ閲覧可能、という
-- 意味的には変わらないルールを、チーム経由に置き換える)
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.team_members tm1
    join public.team_members tm2 on tm1.team_id = tm2.team_id
    where tm1.supabase_user_id = profiles.id and tm1.status = 'active'
      and tm2.supabase_user_id = auth.uid() and tm2.status = 'active'
  )
);

drop table public.group_members;

-- ============================================================
-- 5. RPC: チーム作成、プロジェクト作成、チーム脱退、招待承諾
-- ============================================================

drop function if exists public.create_group_with_owner(text);
drop function if exists public.leave_group(uuid);

create or replace function public.create_team_with_owner(team_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  insert into public.teams(name, created_by) values(team_name, auth.uid()) returning id into tid;
  insert into public.team_members(team_id, supabase_user_id, discord_user_id, role)
    select tid, auth.uid(), discord_user_id, 'owner' from public.profiles where id = auth.uid();
  return tid;
end $$;
grant execute on function public.create_team_with_owner(text) to authenticated;

create or replace function public.create_project(tid uuid, project_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if not public.is_team_member(tid) then
    raise exception 'このチームのメンバーではありません。';
  end if;
  insert into public.groups(name, team_id, created_by) values(project_name, tid, auth.uid()) returning id into gid;
  return gid;
end $$;
grant execute on function public.create_project(uuid, text) to authenticated;

create or replace function public.leave_team(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare my_role text; owners_left int;
begin
  select role into my_role from public.team_members where team_id = tid and supabase_user_id = auth.uid() and status = 'active';
  if my_role is null then raise exception 'このチームのメンバーではありません。'; end if;
  if my_role = 'owner' then
    select count(*) into owners_left from public.team_members
      where team_id = tid and role = 'owner' and status = 'active' and supabase_user_id <> auth.uid();
    if owners_left = 0 then raise exception 'オーナーが他にいないため脱退できません。先に他のメンバーをオーナーにしてください。'; end if;
  end if;
  delete from public.team_members where team_id = tid and supabase_user_id = auth.uid();
end $$;
grant execute on function public.leave_team(uuid) to authenticated;

create or replace function public.accept_my_discord_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; my_discord text; r record;
begin
  select discord_user_id into my_discord from public.profiles where id = auth.uid();
  if my_discord is null then return 0; end if;
  for r in select * from public.invites where discord_user_id = my_discord and status = 'pending' and (expires_at is null or expires_at > now()) loop
    insert into public.team_members(team_id, supabase_user_id, discord_user_id, role)
      values(r.team_id, auth.uid(), my_discord, r.role) on conflict(team_id, supabase_user_id) do nothing;
    update public.invites set status = 'accepted' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.accept_my_discord_invites() to authenticated;

-- ============================================================
-- 6. RLS
-- ============================================================

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create policy teams_read on public.teams for select to authenticated using (public.is_team_member(id));
create policy teams_update on public.teams for update to authenticated using (public.is_team_admin(id));

create policy team_members_read on public.team_members for select to authenticated using (public.is_team_member(team_id));
create policy team_members_update on public.team_members for update to authenticated using (public.is_team_admin(team_id));
create policy team_members_delete on public.team_members for delete to authenticated using (public.is_team_admin(team_id));

drop policy if exists groups_read on public.groups;
drop policy if exists groups_update on public.groups;
create policy groups_read on public.groups for select to authenticated using (public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated using (public.is_group_admin(id));
create policy groups_delete on public.groups for delete to authenticated using (public.is_group_admin(id));

drop policy if exists invites_read on public.invites;
drop policy if exists invites_insert on public.invites;
drop policy if exists invites_update on public.invites;
drop policy if exists invites_delete on public.invites;
create policy invites_read on public.invites for select to authenticated using (public.is_team_admin(team_id) or discord_user_id = (select discord_user_id from public.profiles where id = auth.uid()));
create policy invites_insert on public.invites for insert to authenticated with check (public.is_team_admin(team_id));
create policy invites_update on public.invites for update to authenticated using (public.is_team_admin(team_id) or discord_user_id = (select discord_user_id from public.profiles where id = auth.uid()));
create policy invites_delete on public.invites for delete to authenticated using (public.is_team_admin(team_id));

drop policy if exists events_all on public.events;
drop policy if exists events_read on public.events;
drop policy if exists events_write on public.events;
drop policy if exists events_update on public.events;
drop policy if exists events_delete on public.events;
create policy events_read on public.events for select to authenticated using (public.is_team_member(team_id));
create policy events_write on public.events for insert to authenticated with check (public.is_team_editor(team_id));
create policy events_update on public.events for update to authenticated using (public.is_team_editor(team_id)) with check (public.is_team_editor(team_id));
create policy events_delete on public.events for delete to authenticated using (public.is_team_editor(team_id));

-- ============================================================
-- 7. リマインド通知: チーム単位に集約(プロジェクト横断)して1チャンネルへ
-- ============================================================

create or replace function public.notify_due_tasks() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in
    select t.id, t.title, t.due_date, t.due_time, tm.name as team_name, tm.discord_webhook_url
    from public.tasks t
    join public.groups g on g.id = t.group_id
    join public.teams tm on tm.id = g.team_id
    where tm.discord_webhook_url is not null
      and t.status <> 'done'
      and t.due_date is not null
      and t.notified_at is null
      and ((t.due_date + coalesce(t.due_time, '00:00'::time)) at time zone 'Asia/Tokyo')
            - (coalesce(t.reminder_minutes, tm.task_reminder_minutes, 0) || ' minutes')::interval <= now()
  loop
    perform net.http_post(
      url := r.discord_webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('content', format(
        E'⏰ **%s** の期限です: %s（期限: %s%s）',
        r.team_name, r.title, r.due_date,
        case when r.due_time is not null then ' ' || to_char(r.due_time, 'HH24:MI') else '' end
      ))
    );
    update public.tasks set notified_at = now() where id = r.id;
  end loop;

  for r in
    select e.id, e.title, e.start_at, tm.name as team_name, tm.discord_webhook_url
    from public.events e
    join public.teams tm on tm.id = e.team_id
    where tm.discord_webhook_url is not null
      and e.notified_at is null
      and e.start_at - (coalesce(e.reminder_minutes, tm.event_reminder_minutes, 60) || ' minutes')::interval <= now()
      and e.start_at >= now() - interval '1 day'
  loop
    perform net.http_post(
      url := r.discord_webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('content', format(
        '📅 **%s** まもなく開始: %s（%s）',
        r.team_name, r.title, to_char(r.start_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI')
      ))
    );
    update public.events set notified_at = now() where id = r.id;
  end loop;
end $$;

-- ============================================================
-- 8. ついでの修正: invites/task_page_blocksがRealtime配信対象に
--    登録されておらず、招待の即時反映とタスク詳細のチャットがポーリング
--    頼み/更新されない状態になっていた不具合を修正する。
-- ============================================================

alter publication supabase_realtime add table public.invites;
alter publication supabase_realtime add table public.task_page_blocks;

-- ============================================================
-- 9. task_summaryにteam_id/project_nameを追加
--    (チーム共通カレンダーがプロジェクト横断でタスク期限を集約表示するため、
--    どのチーム/プロジェクトのタスクかをビュー側で分かるようにする)
-- ============================================================

drop view if exists public.task_summary;

create view public.task_summary
with (security_invoker = true) as
select
  t.*,
  g.team_id,
  g.name as project_name,
  p.display_name as assignee_display_name,
  p.avatar_url as assignee_avatar_url,
  coalesce(c.cnt, 0) as comment_count,
  coalesce(l.cnt, 0) as link_count,
  coalesce(a.cnt, 0) as attachment_count
from public.tasks t
join public.groups g on g.id = t.group_id
left join public.profiles p on p.id = t.assigned_to
left join (select task_id, count(*) cnt from public.task_comments group by task_id) c on c.task_id = t.id
left join (select task_id, count(*) cnt from public.task_links group by task_id) l on l.task_id = t.id
left join (select task_id, count(*) cnt from public.task_attachments group by task_id) a on a.task_id = t.id;

grant select on public.task_summary to authenticated;

