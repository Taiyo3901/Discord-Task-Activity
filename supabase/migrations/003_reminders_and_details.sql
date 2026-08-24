-- 003_reminders_and_details.sql
-- タスクの期限に時刻を追加し、タスク/予定それぞれのDiscordリマインド通知タイミングを
-- グループ単位で設定できるようにする。notify_due_tasks()を「一定間隔で繰り返し通知」から
-- 「設定した時間だけ前に一度だけ通知」に作り直す。

alter table public.tasks add column if not exists due_time time;

alter table public.groups add column if not exists task_reminder_minutes integer not null default 0 check (task_reminder_minutes >= 0);
alter table public.groups add column if not exists event_reminder_minutes integer not null default 60 check (event_reminder_minutes >= 0);

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
            - (coalesce(g.task_reminder_minutes, 0) || ' minutes')::interval <= now()
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
      and e.start_at - (coalesce(g.event_reminder_minutes, 60) || ' minutes')::interval <= now()
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
