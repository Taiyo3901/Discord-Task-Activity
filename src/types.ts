import type { SupabaseClient } from "@supabase/supabase-js";

export type AppSession = {
  client: SupabaseClient;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type Role = "owner" | "admin" | "member" | "viewer";
export type TaskStatus = "todo" | "doing" | "review" | "done";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
};

export type Group = {
  id: string;
  name: string;
  discord_guild_id: string | null;
  discord_webhook_url: string | null;
  task_reminder_minutes: number;
  event_reminder_minutes: number;
  created_by: string;
  created_at: string;
};

export type Task = {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  due_date: string | null;
  due_time: string | null;
  assigned_to: string | null;
  assigned_to_all: boolean;
  reminder_minutes: number | null;
  created_by: string;
  updated_by: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskSummary = Task & {
  assignee_display_name: string | null;
  assignee_avatar_url: string | null;
  link_count: number;
  attachment_count: number;
};

export type TaskPage = {
  id: string;
  task_id: string;
  title: string;
  content: string;
  version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EventItem = {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  reminder_minutes: number | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PresencePayload = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  status: "viewing" | "editing";
  field: string | null;
  updated_at: string;
};
