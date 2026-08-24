import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import type { Group, PresencePayload, Task, TaskPage, TaskStatus } from "../../types";
import { Modal } from "../../components/ui/Modal";
import { Avatar } from "../../components/ui/Avatar";
import { useToast } from "../../components/ui/ToastProvider";
import { REMINDER_OPTIONS } from "../../lib/reminders";
import { LinksPanel } from "./LinksPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";

const STATUS_LABEL: Record<TaskStatus, string> = { todo: "未着手", doing: "進行中", review: "確認待ち", done: "完了" };
const SAVE_LABEL: Record<string, string> = { saved: "保存済み", editing: "編集中", saving: "保存中", conflict: "競合あり" };

type Member = { supabase_user_id: string; profiles: { display_name: string | null } | null };
type EditorProfile = { display_name: string | null; avatar_url: string | null };

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

export function TaskModal({
  client,
  group,
  taskId,
  currentUserId,
  displayName,
  avatarUrl,
  onClose,
}: {
  client: SupabaseClient;
  group: Group;
  taskId: string;
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const { data, error } = await client.from("tasks").select("*").eq("id", taskId).single();
      if (error) throw error;
      return data as Task;
    },
  });

  const membersQuery = useQuery({
    queryKey: ["group-members-lite", group.id],
    queryFn: async () => {
      const { data, error } = await client
        .from("group_members")
        .select("supabase_user_id, profiles(display_name)")
        .eq("group_id", group.id)
        .eq("status", "active");
      if (error) throw error;
      return (data ?? []) as unknown as Member[];
    },
  });

  const task = taskQuery.data;
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  useEffect(() => {
    if (task) {
      setTitleDraft(task.title);
      setDescriptionDraft(task.description ?? "");
    }
  }, [task?.id, task?.title, task?.description]);

  const invalidateTask = () => {
    void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["tasks", group.id] });
  };

  const updateTask = useMutation({
    mutationFn: async (
      patch: Partial<
        Pick<Task, "title" | "description" | "status" | "priority" | "due_date" | "due_time" | "assigned_to" | "notified_at" | "reminder_minutes">
      >,
    ) => {
      const { error } = await client.from("tasks").update({ ...patch, updated_by: currentUserId }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: invalidateTask,
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  /** 期限を変更したら、そのタイミングでリマインド通知が再度飛ぶよう notified_at をリセットする。 */
  function updateDue(patch: { due_date?: string | null; due_time?: string | null }) {
    updateTask.mutate({ ...patch, notified_at: null });
  }

  const deleteTask = useMutation({
    mutationFn: async () => {
      const { error } = await client.from("tasks").delete().eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", group.id] });
      onClose();
    },
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  // ページ本文: プレゼンス共有 + 3秒後自動保存 + バージョン競合検知。
  const [page, setPage] = useState<TaskPage | null>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"saved" | "editing" | "saving" | "conflict">("saved");
  const [presence, setPresence] = useState<PresencePayload[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const editorQuery = useQuery({
    queryKey: ["task-page-editor", page?.updated_by],
    queryFn: async () => {
      const { data } = await client.from("profiles").select("display_name,avatar_url").eq("id", page!.updated_by!).maybeSingle();
      return data as EditorProfile | null;
    },
    enabled: !!page?.updated_by,
  });

  useEffect(() => {
    void loadPage();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (!page) return;
    const channel = client.channel(`task-page-${page.id}`, { config: { presence: { key: currentUserId } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const values = Object.values(channel.presenceState()).flat() as unknown as PresencePayload[];
        setPresence(values.filter((p) => p.user_id !== currentUserId));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "task_pages", filter: `id=eq.${page.id}` }, (payload) => {
        const updated = payload.new as TaskPage;
        setPage((current) => {
          if (current && updated.version > current.version && stateRef.current === "saved") setDraft(updated.content);
          return updated;
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void track("viewing");
      });
    return () => {
      channelRef.current = null;
      void client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, currentUserId]);

  async function loadPage() {
    const { data } = await client.from("task_pages").select("*").eq("task_id", taskId).single();
    if (data) {
      setPage(data);
      setDraft(data.content);
      setState("saved");
    }
  }

  async function track(status: "viewing" | "editing") {
    await channelRef.current?.track({
      user_id: currentUserId,
      display_name: displayName,
      avatar_url: avatarUrl,
      status,
      field: status === "editing" ? "content" : null,
      updated_at: new Date().toISOString(),
    } satisfies PresencePayload);
  }

  function onChangeDraft(value: string) {
    setDraft(value);
    setState("editing");
    void track("editing");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void save(value), 3000);
  }

  async function save(value: string) {
    if (!page) return;
    setState("saving");
    const { data, error } = await client
      .from("task_pages")
      .update({ content: value, version: page.version + 1, updated_by: currentUserId })
      .eq("id", page.id)
      .eq("version", page.version)
      .select()
      .maybeSingle();
    if (error || !data) {
      setState("conflict");
      return;
    }
    setPage(data);
    setDraft(data.content);
    setState("saved");
    await track("viewing");
  }

  async function reloadLatest() {
    if (!page) return;
    const { data } = await client.from("task_pages").select("*").eq("id", page.id).single();
    if (data) {
      setPage(data);
      setDraft(data.content);
      setState("saved");
    }
  }

  async function overwrite() {
    if (!page) return;
    const { data: latest } = await client.from("task_pages").select("version").eq("id", page.id).single();
    const { data } = await client
      .from("task_pages")
      .update({ content: draft, version: (latest?.version ?? page.version) + 1, updated_by: currentUserId })
      .eq("id", page.id)
      .select()
      .single();
    if (data) {
      setPage(data);
      setState("saved");
    }
  }

  if (!task) {
    return (
      <Modal onClose={onClose}>
        <div className="modal-body">読み込み中...</div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <header className="modal-header">
        <input
          className="modal-title-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => titleDraft.trim() && titleDraft !== task.title && updateTask.mutate({ title: titleDraft.trim() })}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <span className={`save-state ${state}`}>{SAVE_LABEL[state]}</span>
          <button
            className="btn-icon"
            onClick={() => window.confirm("このタスクを削除しますか？") && deleteTask.mutate()}
            aria-label="タスクを削除"
          >
            <Trash2 size={16} />
          </button>
          <button className="btn-icon" onClick={onClose} aria-label="閉じる">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="modal-layout">
        <div className="modal-main">
          {presence.length > 0 && (
            <div className="presence-box">
              {presence.map((p, i) => (
                <span key={`${p.user_id}-${i}`} className="presence-chip">
                  <Avatar name={p.display_name} url={p.avatar_url} />
                  {p.display_name}が{p.status === "editing" ? "入力中" : "閲覧中"}
                </span>
              ))}
            </div>
          )}

          {state === "conflict" && (
            <div className="conflict-box">
              <p>他のメンバーが先に更新しました。編集中の内容は保持されています。</p>
              <div className="actions">
                <button className="btn btn-ghost" onClick={() => void reloadLatest()}>
                  最新版を見る
                </button>
                <button className="btn btn-primary" onClick={() => void overwrite()}>
                  自分の内容で上書き
                </button>
              </div>
            </div>
          )}

          <div className="editor-wrap">
            {page && (
              <span
                className="editor-author-badge"
                title={`${editorQuery.data?.display_name ?? "メンバー"}が${relativeTime(page.updated_at)}に更新`}
              >
                <Avatar name={editorQuery.data?.display_name ?? "?"} url={editorQuery.data?.avatar_url} />
              </span>
            )}
            <textarea
              className="editor editor-large"
              value={draft}
              onChange={(e) => onChangeDraft(e.target.value)}
              placeholder="詳細、メモ、仕様を書いてください。"
            />
          </div>
        </div>

        <aside className="modal-sidebar">
          <div className="field">
            <label>ステータス</label>
            <select value={task.status} onChange={(e) => updateTask.mutate({ status: e.target.value as TaskStatus })}>
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>優先度</label>
            <select value={task.priority} onChange={(e) => updateTask.mutate({ priority: Number(e.target.value) })}>
              <option value={1}>低</option>
              <option value={2}>中</option>
              <option value={3}>高</option>
              <option value={4}>緊急</option>
            </select>
          </div>

          <div className="field">
            <label>期限</label>
            <div className="due-input-row">
              <input type="date" value={task.due_date ?? ""} onChange={(e) => updateDue({ due_date: e.target.value || null })} />
              <input type="time" value={task.due_time ?? ""} onChange={(e) => updateDue({ due_time: e.target.value || null })} disabled={!task.due_date} />
            </div>
            <p className="field-hint">時刻は任意です。空欄なら終日扱いになります。</p>
          </div>

          <div className="field">
            <label>通知タイミング</label>
            <select
              value={task.reminder_minutes ?? "default"}
              onChange={(e) => updateTask.mutate({ reminder_minutes: e.target.value === "default" ? null : Number(e.target.value) })}
            >
              <option value="default">グループの既定値を使う</option>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="field-hint">このタスクだけ、期限に対するリマインドのタイミングを個別に変更できます。</p>
          </div>

          <div className="field">
            <label>担当者</label>
            <select value={task.assigned_to ?? ""} onChange={(e) => updateTask.mutate({ assigned_to: e.target.value || null })}>
              <option value="">未割り当て</option>
              {(membersQuery.data ?? []).map((m) => (
                <option key={m.supabase_user_id} value={m.supabase_user_id}>
                  {m.profiles?.display_name ?? "メンバー"}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>概要（カレンダーにも表示）</label>
            <textarea
              className="task-summary-input"
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={() => descriptionDraft !== (task.description ?? "") && updateTask.mutate({ description: descriptionDraft.trim() || null })}
              placeholder="一覧やカレンダーに出す短い概要（任意）"
            />
          </div>

          <LinksPanel client={client} taskId={taskId} userId={currentUserId} />
          <AttachmentsPanel client={client} taskId={taskId} groupId={group.id} userId={currentUserId} />
        </aside>
      </div>
    </Modal>
  );
}
