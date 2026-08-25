import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Project, Team } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { REMINDER_OPTIONS } from "../../lib/reminders";

export function TeamSettingsView({ client, team, currentUserId }: { client: SupabaseClient; team: Team; currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [webhookUrl, setWebhookUrl] = useState(team.discord_webhook_url ?? "");
  const [guildId, setGuildId] = useState(team.discord_guild_id ?? "");
  const [taskReminderMinutes, setTaskReminderMinutes] = useState(team.task_reminder_minutes);
  const [eventReminderMinutes, setEventReminderMinutes] = useState(team.event_reminder_minutes);

  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");

  useEffect(() => {
    setName(team.name);
    setWebhookUrl(team.discord_webhook_url ?? "");
    setGuildId(team.discord_guild_id ?? "");
    setTaskReminderMinutes(team.task_reminder_minutes);
    setEventReminderMinutes(team.event_reminder_minutes);
  }, [team.id]);

  const roleQuery = useQuery({
    queryKey: ["my-role", team.id, currentUserId],
    queryFn: async () => {
      const { data } = await client.from("team_members").select("role").eq("team_id", team.id).eq("supabase_user_id", currentUserId).maybeSingle();
      return data?.role ?? null;
    },
  });
  const isAdmin = roleQuery.data === "owner" || roleQuery.data === "admin";

  const projectsKey = ["projects", team.id];
  const projectsQuery = useQuery({
    queryKey: projectsKey,
    queryFn: async () => {
      const { data, error } = await client.from("groups").select("*").eq("team_id", team.id).order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
  const projects = projectsQuery.data ?? [];

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await client
        .from("teams")
        .update({
          name: name.trim(),
          discord_webhook_url: webhookUrl.trim() || null,
          discord_guild_id: guildId.trim() || null,
          task_reminder_minutes: taskReminderMinutes,
          event_reminder_minutes: eventReminderMinutes,
        })
        .eq("id", team.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("設定を保存しました。", "success");
      void queryClient.invalidateQueries({ queryKey: ["teams", currentUserId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存に失敗しました。", "error"),
  });

  const createProject = useMutation({
    mutationFn: async (projectName: string) => {
      const { error } = await client.rpc("create_project", { tid: team.id, project_name: projectName });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewProjectName("");
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "プロジェクト作成に失敗しました。", "error"),
  });

  const renameProject = useMutation({
    mutationFn: async ({ id, projectName }: { id: string; projectName: string }) => {
      const { error } = await client.from("groups").update({ name: projectName }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingProjectId(null);
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("groups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: projectsKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  if (!isAdmin) {
    return (
      <section className="panel">
        <h2>設定</h2>
        <p className="field-hint">設定の変更にはオーナーまたは管理者権限が必要です。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>設定</h2>

      <div className="field">
        <label>チーム名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="panel-section">
        <h3>Discord連携</h3>

        <div className="field" style={{ marginTop: 12 }}>
          <label>通知用Webhook URL</label>
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." />
          <p className="field-hint">
            チーム内の全プロジェクトの、期限が近い/過ぎたタスクと開始間近の予定を、このWebhook宛に1つのチャンネルへまとめて自動通知します。
            Discordのチャンネル設定 → 連携サービス → ウェブフック → 新しいウェブフックから発行できます。
          </p>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>連携するサーバーID (Guild ID)</label>
          <input value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="123456789012345678" />
          <p className="field-hint">設定すると、そのサーバーの「/task add タイトル:...」コマンドからこのチームのプロジェクトへタスクを追加できます。</p>
        </div>
      </div>

      <div className="panel-section">
        <h3>通知タイミング（既定値）</h3>
        <p className="field-hint">ここで設定した内容が、個別に指定していないタスク・予定のデフォルトになります。タスクや予定ごとに個別のタイミングを設定したい場合は、それぞれの詳細画面から設定してください。</p>

        <div className="field" style={{ marginTop: 12 }}>
          <label>タスクの期限リマインド（既定値）</label>
          <select value={taskReminderMinutes} onChange={(e) => setTaskReminderMinutes(Number(e.target.value))}>
            {REMINDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="field-hint">タスクの期限（時刻未設定の場合は0:00扱い）の、指定した時間前に通知します。</p>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>予定の開始リマインド（既定値）</label>
          <select value={eventReminderMinutes} onChange={(e) => setEventReminderMinutes(Number(e.target.value))}>
            {REMINDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="field-hint">予定の開始時刻の、指定した時間前に通知します。</p>
        </div>
      </div>

      <div className="panel-section">
        <button className="btn btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          保存
        </button>
      </div>

      <div className="panel-section">
        <h3>プロジェクト</h3>
        <p className="field-hint">プロジェクトはチーム内のボードの単位です。チームのメンバーは全プロジェクトに自動でアクセスできます。</p>

        <div className="list">
          {projects.map((p) =>
            editingProjectId === p.id ? (
              <div className="toolbar-row" key={p.id}>
                <input value={editingProjectName} onChange={(e) => setEditingProjectName(e.target.value)} autoFocus />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!editingProjectName.trim()}
                  onClick={() => renameProject.mutate({ id: p.id, projectName: editingProjectName.trim() })}
                >
                  保存
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingProjectId(null)}>
                  キャンセル
                </button>
              </div>
            ) : (
              <article className="list-card" key={p.id}>
                <div className="list-card-main">
                  <div className="list-card-title">{p.name}</div>
                </div>
                <div className="list-card-actions">
                  <button
                    className="btn-icon"
                    aria-label="名前を変更"
                    onClick={() => {
                      setEditingProjectId(p.id);
                      setEditingProjectName(p.name);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    aria-label="削除"
                    onClick={() => window.confirm(`「${p.name}」を削除しますか？タスクも全て削除されます。`) && deleteProject.mutate(p.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ),
          )}
        </div>

        <div className="toolbar-row">
          <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="新しいプロジェクト名" />
          <button
            className="btn btn-primary btn-sm"
            disabled={!newProjectName.trim() || createProject.isPending}
            onClick={() => void createProject.mutate(newProjectName.trim())}
          >
            <Plus size={14} />
            作成
          </button>
        </div>
      </div>
    </section>
  );
}
