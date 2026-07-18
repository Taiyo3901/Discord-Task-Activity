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
  assigned_to: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
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
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PresencePayload = {
  user_id: string;
  display_name: string;
  status: "viewing" | "editing";
  field: string | null;
  updated_at: string;
};
