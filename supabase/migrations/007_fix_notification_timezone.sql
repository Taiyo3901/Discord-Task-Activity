-- 007_fix_notification_timezone.sql
-- 通知関数がUTCのまま時刻を扱っていたため、予定の通知メッセージに表示される時刻が
-- 実際の設定時刻(日本時間)からずれていた(例: 21:30設定 → 通知には12:30と表示)。
-- 同じ理由で、時刻付きタスクの期限リマインドのタイミング計算もずれていたため、
-- いずれもAsia/Tokyoとして解釈・表示するよう修正する。

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
      and ((t.due_date + coalesce(t.due_time, '00:00'::time)) at time zone 'Asia/Tokyo')
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
      body := jsonb_build_object('content', format(
        '📅 **%s** まもなく開始: %s（%s）',
        r.group_name, r.title, to_char(r.start_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI')
      ))
    );
    update public.events set notified_at = now() where id = r.id;
  end loop;
end $$;
