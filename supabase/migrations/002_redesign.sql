-- 002_redesign.sql
-- Discord Activity埋め込み対応・Trello風UI・CRUD拡充・通知機能のための追加マイグレーション。
-- 001_init.sqlは変更せず、積み増しで適用する。

-- ============================================================
-- 1. 権限まわり: viewerを実質読み取り専用にする
-- ============================================================

create or replace function public.is_group_editor(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.group_members
    where group_id = gid and supabase_user_id = auth.uid()
      and status = 'active' and role in ('owner', 'admin', 'member')
  )
$$;

-- ============================================================
-- 2. profilesの閲覧範囲を「自分」または「同じグループの相手」に限定
-- ============================================================

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.group_members gm1
    join public.group_members gm2 on gm1.group_id = gm2.group_id
    where gm1.supabase_user_id = profiles.id and gm1.status = 'active'
      and gm2.supabase_user_id = auth.uid() and gm2.status = 'active'
  )
);

-- ============================================================
-- 3. タスク/予定: read=is_group_member, write=is_group_editor に分割
-- ============================================================

drop policy if exists tasks_all on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using (public.is_group_member(group_id));
create policy tasks_write on public.tasks for insert to authenticated with check (public.is_group_editor(group_id));
create policy tasks_update on public.tasks for update to authenticated using (public.is_group_editor(group_id)) with check (public.is_group_editor(group_id));
create policy tasks_delete on public.tasks for delete to authenticated using (public.is_group_editor(group_id));

drop policy if exists events_all on public.events;
create policy events_read on public.events for select to authenticated using (public.is_group_member(group_id));
create policy events_write on public.events for insert to authenticated with check (public.is_group_editor(group_id));
create policy events_update on public.events for update to authenticated using (public.is_group_editor(group_id)) with check (public.is_group_editor(group_id));
create policy events_delete on public.events for delete to authenticated using (public.is_group_editor(group_id));

drop policy if exists pages_all on public.task_pages;
create policy pages_read on public.task_pages for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))
);
create policy pages_write on public.task_pages for insert to authenticated with check (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
);
create policy pages_update on public.task_pages for update to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
) with check (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
);

-- ============================================================
-- 4. リンク/コメント/添付: 作成者本人または管理者のみ削除できるように
-- ============================================================

drop policy if exists links_all on public.task_links;
create policy links_read on public.task_links for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))
);
create policy links_write on public.task_links for insert to authenticated with check (
  created_by = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
);
create policy links_delete on public.task_links for delete to authenticated using (
  created_by = auth.uid() or exists (select 1 from public.tasks t where t.id = task_id and public.is_group_admin(t.group_id))
);

drop policy if exists comments_all on public.task_comments;
create policy comments_read on public.task_comments for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))
);
create policy comments_write on public.task_comments for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
);
create policy comments_update on public.task_comments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy comments_delete on public.task_comments for delete to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.tasks t where t.id = task_id and public.is_group_admin(t.group_id))
);

drop policy if exists attachments_all on public.task_attachments;
create policy attachments_read on public.task_attachments for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))
);
create policy attachments_write on public.task_attachments for insert to authenticated with check (
  uploaded_by = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and public.is_group_editor(t.group_id))
);
create policy attachments_delete on public.task_attachments for delete to authenticated using (
  uploaded_by = auth.uid() or exists (select 1 from public.tasks t where t.id = task_id and public.is_group_admin(t.group_id))
);

drop policy if exists task_files_insert on storage.objects;
create policy task_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'task-files'
  and public.is_group_editor(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[3] = auth.uid()::text
);
drop policy if exists task_files_delete on storage.objects;
create policy task_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'task-files'
  and public.is_group_editor(((storage.foldername(name))[1])::uuid)
  and ((storage.foldername(name))[3] = auth.uid()::text or public.is_group_admin(((storage.foldername(name))[1])::uuid))
);

-- ============================================================
-- 5. 招待の取消、グループ脱退
-- ============================================================

create policy invites_delete on public.invites for delete to authenticated using (public.is_group_admin(group_id));

create or replace function public.leave_group(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare my_role text; owners_left int;
begin
  select role into my_role from public.group_members where group_id = gid and supabase_user_id = auth.uid() and status = 'active';
  if my_role is null then raise exception 'このグループのメンバーではありません。'; end if;
  if my_role = 'owner' then
    select count(*) into owners_left from public.group_members
      where group_id = gid and role = 'owner' and status = 'active' and supabase_user_id <> auth.uid();
    if owners_left = 0 then raise exception 'オーナーが他にいないため脱退できません。先に他のメンバーをオーナーにしてください。'; end if;
  end if;
  delete from public.group_members where group_id = gid and supabase_user_id = auth.uid();
end $$;
grant execute on function public.leave_group(uuid) to authenticated;

create policy members_delete on public.group_members for delete to authenticated using (public.is_group_admin(group_id));

-- ============================================================
-- 6. 通知用カラムとカンバン集計ビュー
-- ============================================================

alter table public.groups add column if not exists discord_webhook_url text
  check (discord_webhook_url is null or discord_webhook_url ~ '^https://discord(app)?\.com/api/webhooks/');

alter table public.tasks add column if not exists notified_at timestamptz;
alter table public.events add column if not exists notified_at timestamptz;

create index if not exists tasks_due_date_idx on public.tasks(group_id, due_date) where status <> 'done';
create index if not exists events_start_at_idx on public.events(group_id, start_at);
create index if not exists task_comments_user_idx on public.task_comments(user_id);
create index if not exists task_links_creator_idx on public.task_links(created_by);
create index if not exists task_attachments_uploader_idx on public.task_attachments(uploaded_by);

create or replace view public.task_summary
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

-- ============================================================
-- 7. 期限リマインド (pg_cron + pg_net, Botプロセス不要)
-- ============================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_due_tasks() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in
    select t.id, t.title, t.due_date, g.name as group_name, g.discord_webhook_url
    from public.tasks t join public.groups g on g.id = t.group_id
    where g.discord_webhook_url is not null
      and t.status <> 'done'
      and t.due_date is not null
      and t.due_date <= (now() at time zone 'utc')::date
      and (t.notified_at is null or t.notified_at < now() - interval '20 hours')
  loop
    perform net.http_post(
      url := r.discord_webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('content', format(E'⏰ **%s** の期限です: %s（期限: %s）', r.group_name, r.title, r.due_date))
    );
    update public.tasks set notified_at = now() where id = r.id;
  end loop;

  for r in
    select e.id, e.title, e.start_at, g.name as group_name, g.discord_webhook_url
    from public.events e join public.groups g on g.id = e.group_id
    where g.discord_webhook_url is not null
      and e.start_at between now() and now() + interval '1 hour'
      and e.notified_at is null
  loop
    perform net.http_post(
      url := r.discord_webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('content', format('📅 **%s** まもなく開始: %s（%s）', r.group_name, r.title, to_char(r.start_at, 'YYYY-MM-DD HH24:MI')))
    );
    update public.events set notified_at = now() where id = r.id;
  end loop;
end $$;

grant execute on function public.notify_due_tasks() to postgres;

-- 30分おきに実行登録（同名ジョブが既にあれば置き換え）。
-- pg_cron / pg_netがダッシュボードでまだ有効化されていない環境ではこのブロックが失敗することがあります。
-- その場合はDatabase > ExtensionsでON にしてから、このSELECT文だけ手動で再実行してください。
select cron.unschedule(jobid) from cron.job where jobname = 'notify-due-tasks';
select cron.schedule('notify-due-tasks', '*/30 * * * *', $$select public.notify_due_tasks()$$);
