create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  discord_user_id text unique,
  discord_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discord_guild_id text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  supabase_user_id uuid not null references public.profiles(id) on delete cascade,
  discord_user_id text,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  status text not null default 'active' check (status in ('active','removed')),
  joined_at timestamptz not null default now(),
  unique(group_id, supabase_user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  discord_user_id text not null,
  role text not null default 'member' check (role in ('admin','member','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','expired')),
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups(id) on delete cascade,
  title text not null, description text, start_at timestamptz not null, end_at timestamptz,
  created_by uuid not null references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.groups(id) on delete cascade,
  title text not null, description text, status text not null default 'todo' check (status in ('todo','doing','review','done')),
  priority int not null default 2, due_date date, assigned_to uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.task_pages (
  id uuid primary key default gen_random_uuid(), task_id uuid not null unique references public.tasks(id) on delete cascade,
  title text not null, content text not null default '', version int not null default 1,
  updated_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.task_links (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  url text not null check (url ~ '^https://'), label text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id), body text not null, discord_message_id text, created_at timestamptz not null default now()
);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id), bucket_name text not null, file_path text not null,
  original_file_name text not null, mime_type text, file_size bigint, created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger task_pages_touch before update on public.task_pages for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name,avatar_url) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,'user'),'@',1)),new.raw_user_meta_data->>'avatar_url')
  on conflict(id) do update set email=excluded.email;
  return new;
end $$;
create trigger auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_group_member(gid uuid) returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.group_members where group_id=gid and supabase_user_id=auth.uid() and status='active')
$$;
create or replace function public.is_group_admin(gid uuid) returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.group_members where group_id=gid and supabase_user_id=auth.uid() and status='active' and role in ('owner','admin'))
$$;

create or replace function public.create_group_with_owner(group_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare gid uuid;
begin
  insert into public.groups(name,created_by) values(group_name,auth.uid()) returning id into gid;
  insert into public.group_members(group_id,supabase_user_id,discord_user_id,role) select gid,auth.uid(),discord_user_id,'owner' from public.profiles where id=auth.uid();
  return gid;
end $$;

create or replace function public.accept_my_discord_invites() returns int language plpgsql security definer set search_path=public as $$
declare n int:=0; my_discord text; r record;
begin
  select discord_user_id into my_discord from public.profiles where id=auth.uid();
  if my_discord is null then return 0; end if;
  for r in select * from public.invites where discord_user_id=my_discord and status='pending' and (expires_at is null or expires_at>now()) loop
    insert into public.group_members(group_id,supabase_user_id,discord_user_id,role) values(r.group_id,auth.uid(),my_discord,r.role) on conflict(group_id,supabase_user_id) do nothing;
    update public.invites set status='accepted' where id=r.id; n:=n+1;
  end loop;
  return n;
end $$;

grant execute on function public.create_group_with_owner(text) to authenticated;
grant execute on function public.accept_my_discord_invites() to authenticated;

alter table public.profiles enable row level security; alter table public.groups enable row level security; alter table public.group_members enable row level security; alter table public.invites enable row level security;
alter table public.events enable row level security; alter table public.tasks enable row level security; alter table public.task_pages enable row level security; alter table public.task_links enable row level security; alter table public.task_comments enable row level security; alter table public.task_attachments enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(true);
create policy profiles_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy profiles_insert_self on public.profiles for insert to authenticated with check(id=auth.uid());
create policy groups_read on public.groups for select to authenticated using(public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated using(public.is_group_admin(id));
create policy members_read on public.group_members for select to authenticated using(public.is_group_member(group_id));
create policy members_update on public.group_members for update to authenticated using(public.is_group_admin(group_id));
create policy invites_read on public.invites for select to authenticated using(public.is_group_admin(group_id) or discord_user_id=(select discord_user_id from public.profiles where id=auth.uid()));
create policy invites_insert on public.invites for insert to authenticated with check(public.is_group_admin(group_id));
create policy invites_update on public.invites for update to authenticated using(public.is_group_admin(group_id) or discord_user_id=(select discord_user_id from public.profiles where id=auth.uid()));
create policy events_all on public.events for all to authenticated using(public.is_group_member(group_id)) with check(public.is_group_member(group_id));
create policy tasks_all on public.tasks for all to authenticated using(public.is_group_member(group_id)) with check(public.is_group_member(group_id));
create policy pages_all on public.task_pages for all to authenticated using(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id))) with check(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id)));
create policy links_all on public.task_links for all to authenticated using(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id))) with check(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id)));
create policy comments_all on public.task_comments for all to authenticated using(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id))) with check(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id)));
create policy attachments_all on public.task_attachments for all to authenticated using(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id))) with check(exists(select 1 from public.tasks t where t.id=task_id and public.is_group_member(t.group_id)));

insert into storage.buckets(id,name,public,file_size_limit) values('task-files','task-files',false,52428800) on conflict(id) do nothing;
create policy task_files_read on storage.objects for select to authenticated using(bucket_id='task-files' and public.is_group_member(((storage.foldername(name))[1])::uuid));
create policy task_files_insert on storage.objects for insert to authenticated with check(bucket_id='task-files' and public.is_group_member(((storage.foldername(name))[1])::uuid));
create policy task_files_delete on storage.objects for delete to authenticated using(bucket_id='task-files' and public.is_group_member(((storage.foldername(name))[1])::uuid));

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_pages;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.task_comments;
alter publication supabase_realtime add table public.task_links;
alter publication supabase_realtime add table public.task_attachments;
