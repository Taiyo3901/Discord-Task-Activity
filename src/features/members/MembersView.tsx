import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Square, Trash2, X } from "lucide-react";
import type { Role, Team, TaskSummary } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { Avatar } from "../../components/ui/Avatar";
import { Modal } from "../../components/ui/Modal";
import { TaskModal } from "../tasks/TaskModal";

type Member = {
  id: string;
  supabase_user_id: string;
  role: Role;
  profiles: { display_name: string | null; discord_username: string | null; avatar_url: string | null } | null;
};
type LookupResult = { discord_user_id: string; display_name: string | null; avatar_url: string | null; discord_username: string | null };
type MemberTask = Pick<TaskSummary, "id" | "group_id" | "project_name" | "title" | "status" | "priority" | "due_date" | "due_time">;

export function MembersView({
  client,
  team,
  currentUserId,
  displayName,
  avatarUrl,
}: {
  client: SupabaseClient;
  team: Team;
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [openTask, setOpenTask] = useState<{ id: string; projectId: string } | null>(null);

  const membersKey = ["members", team.id];
  const invitesKey = ["invites", team.id];
  const trimmedUsername = username.trim().replace(/^@/, "");

  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("team_members")
        .select("id,supabase_user_id,role,profiles(display_name,discord_username,avatar_url)")
        .eq("team_id", team.id)
        .eq("status", "active");
      if (error) throw error;
      return (data ?? []) as unknown as Member[];
    },
  });

  const lookupQuery = useQuery({
    queryKey: ["invite-lookup", trimmedUsername],
    queryFn: async () => {
      const { data, error } = await client.rpc("lookup_profile_by_username", { username: trimmedUsername });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as LookupResult | null;
    },
    enabled: trimmedUsername.length >= 2,
  });
  const matched = lookupQuery.data ?? null;
  const notFound = trimmedUsername.length >= 2 && !lookupQuery.isFetching && !matched;

  const members = membersQuery.data ?? [];
  const myRole = members.find((m) => m.supabase_user_id === currentUserId)?.role;
  const isAdmin = myRole === "owner" || myRole === "admin";

  const memberTasksQuery = useQuery({
    queryKey: ["member-tasks", team.id, selectedMember?.supabase_user_id],
    queryFn: async () => {
      const { data, error } = await client
        .from("task_summary")
        .select("id,group_id,project_name,title,status,priority,due_date,due_time")
        .eq("team_id", team.id)
        .eq("assigned_to", selectedMember!.supabase_user_id)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as MemberTask[];
    },
    enabled: !!selectedMember,
  });
  const memberTasks = memberTasksQuery.data ?? [];

  const invite = useMutation({
    mutationFn: async () => {
      if (!matched) throw new Error("ユーザーネームが見つかりません。");
      const { error } = await client.from("invites").insert({
        team_id: team.id,
        discord_user_id: matched.discord_user_id,
        role,
        status: "pending",
        invited_by: currentUserId,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setUsername("");
      void queryClient.invalidateQueries({ queryKey: invitesKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "招待に失敗しました。", "error"),
  });

  const changeRole = useMutation({
    mutationFn: async ({ id, nextRole }: { id: string; nextRole: Role }) => {
      const { error } = await client.from("team_members").update({ role: nextRole }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: membersKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: membersKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  const leaveTeam = useMutation({
    mutationFn: async () => {
      const { error } = await client.rpc("leave_team", { tid: team.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast("チームから脱退しました。", "success");
      void queryClient.invalidateQueries({ queryKey: ["teams", currentUserId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "脱退に失敗しました。", "error"),
  });

  return (
    <section className="panel">
      <h2>メンバー</h2>
      <p className="field-hint">チームに参加すると、チーム内のすべてのプロジェクトに自動的にアクセスできるようになります。メンバーをクリックすると担当タスクを確認できます。</p>

      {isAdmin && (
        <div className="toolbar-row">
          {matched ? (
            <Avatar name={matched.display_name ?? matched.discord_username ?? "?"} url={matched.avatar_url} />
          ) : (
            <span className="avatar invite-preview-empty" />
          )}
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Discordのユーザーネーム" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
          <button className="btn btn-primary" disabled={!matched} onClick={() => invite.mutate()}>
            招待
          </button>
        </div>
      )}
      {isAdmin && notFound && (
        <p className="field-hint invite-not-found">
          このユーザーネームは見つかりませんでした。相手が一度でもこのアプリにログインしていれば表示されます。
        </p>
      )}

      <div className="panel-section">
        <h3>参加中</h3>
        <div className="list">
          {members.map((m) => (
            <article className="list-card list-card-clickable" key={m.id} onClick={() => setSelectedMember(m)}>
              <div className="list-card-main">
                <Avatar name={m.profiles?.display_name ?? m.profiles?.discord_username} url={m.profiles?.avatar_url} />
                <div>
                  <div className="list-card-title">{m.profiles?.display_name ?? m.profiles?.discord_username ?? "メンバー"}</div>
                  <div className="list-card-sub">@{m.profiles?.discord_username ?? "unknown"}</div>
                </div>
              </div>
              <div className="list-card-actions" onClick={(e) => e.stopPropagation()}>
                {isAdmin && m.supabase_user_id !== currentUserId ? (
                  <select value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, nextRole: e.target.value as Role })}>
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                ) : (
                  <span className={`role-badge role-${m.role}`}>{m.role}</span>
                )}
                {isAdmin && m.supabase_user_id !== currentUserId && (
                  <button className="btn-icon" aria-label="削除" onClick={() => window.confirm("このメンバーを削除しますか？") && removeMember.mutate(m.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <button className="btn btn-danger" onClick={() => window.confirm("このチームから脱退しますか？") && leaveTeam.mutate()}>
          チームから脱退
        </button>
      </div>

      {selectedMember && (
        <Modal onClose={() => setSelectedMember(null)}>
          <header className="modal-header">
            <div className="list-card-main">
              <Avatar
                name={selectedMember.profiles?.display_name ?? selectedMember.profiles?.discord_username}
                url={selectedMember.profiles?.avatar_url}
              />
              <div>
                <div className="list-card-title">
                  {selectedMember.profiles?.display_name ?? selectedMember.profiles?.discord_username ?? "メンバー"}の担当タスク
                </div>
              </div>
            </div>
            <button className="btn-icon modal-close-btn" onClick={() => setSelectedMember(null)} aria-label="閉じる">
              <X size={18} />
            </button>
          </header>
          <div className="modal-body">
            {memberTasks.length === 0 ? (
              <div className="day-panel-empty">担当しているタスクはありません。</div>
            ) : (
              <div className="day-panel-list">
                {memberTasks.map((task) => (
                  <button
                    className="day-task-card"
                    key={task.id}
                    data-priority={task.priority}
                    onClick={() => setOpenTask({ id: task.id, projectId: task.group_id })}
                  >
                    {task.status === "done" ? <CheckSquare size={15} /> : <Square size={15} />}
                    <div className="day-event-main">
                      <div className="day-event-top">
                        {task.due_date && (
                          <span className="day-event-time">
                            {task.due_date}
                            {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
                          </span>
                        )}
                        <span className={`day-event-title ${task.status === "done" ? "done" : ""}`}>{task.title}</span>
                      </div>
                      <span className="day-task-project">{task.project_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {openTask && (
        <TaskModal
          client={client}
          project={{ id: openTask.projectId, team_id: team.id }}
          taskId={openTask.id}
          currentUserId={currentUserId}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onClose={() => setOpenTask(null)}
        />
      )}
    </section>
  );
}
