-- 004_calendar_fix_and_item_reminders.sql
-- task_summaryビューは作成時点でt.*を列展開してしまうため、003で追加した
-- due_timeがビューに反映されていなかった（カレンダーにタスクが出ない不具合の原因）。
-- ビューを作り直して反映しつつ、タスク/予定ごとの通知タイミング上書きを追加する。
--
-- 注意: CREATE OR REPLACE VIEWは既存列の並び順を変更できない。t.*が展開する列に
-- 新しい列(due_time, reminder_minutes)が割り込むと既存列の位置がずれてエラーになるため、
-- DROP VIEW + CREATE VIEWで作り直す（他のオブジェクトから参照されていないため安全）。

-- タスク/予定ごとの通知タイミング上書き。nullの場合はグループの既定値を使う。
-- (ビューの再作成より前に列を確定させ、t.*に含めておく)
alter table public.tasks add column if not exists reminder_minutes integer check (reminder_minutes is null or reminder_minutes >= 0);
alter table public.events add column if not exists reminder_minutes integer check (reminder_minutes is null or reminder_minutes >= 0);

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

create or replace function public.notify_due_tasks() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  for r in
    select t.id, t.title, t.due_date, t.due_time, g.name as group_name, g.discord_webhook_url
    from public.tasks t join public.groups g on g.id = t.group_id
    where g.discord_webhook_url is not null
      and t.status <> 'done'
      and t.due_date is not null
      and t.notified_at is null
      and ((t.due_date + coalesce(t.due_time, '00:00'::time)) at time zone 'utc')
            - (coalesce(t.reminder_minutes, g.task_reminder_minutes, 0) || ' minutes')::interval <= now()
  loop
    perform net.http_post(
      url := r.discord_webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('content', format(
        E'⏰ **%s** の期限です: %s（期限: %s%s）',
        r.group_name, r.title, r.due_date,
        case when r.due_time is not null then ' ' || to_char(r.due_time, 'HH24:MI') else '' end
      ))
    );
    update public.tasks set notified_at = now() where id = r.id;
  end loop;

  for r in
    select e.id, e.title, e.start_at, g.name as group_name, g.discord_webhook_url
    from public.events e join public.groups g on g.id = e.group_id
    where g.discord_webhook_url is not null
      and e.notified_at is null
      and e.start_at - (coalesce(e.reminder_minutes, g.event_reminder_minutes, 60) || ' minutes')::interval <= now()
      and e.start_at >= now() - interval '1 day'
  loop
    perform net.http_post(
      url := r.discord_webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('content', format('📅 **%s** まもなく開始: %s（%s）', r.group_name, r.title, to_char(r.start_at, 'YYYY-MM-DD HH24:MI')))
    );
    update public.events set notified_at = now() where id = r.id;
  end loop;
end $$;
