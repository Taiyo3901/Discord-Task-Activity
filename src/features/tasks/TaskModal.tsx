import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, X } from "lucide-react";
import type { PresencePayload, Project, Task, TaskPageBlock, TaskStatus } from "../../types";
import { Modal } from "../../components/ui/Modal";
import { Avatar } from "../../components/ui/Avatar";
import { useToast } from "../../components/ui/ToastProvider";
import { useRealtimeInvalidate } from "../../hooks/useRealtimeInvalidate";
import { REMINDER_OPTIONS } from "../../lib/reminders";
import { LinksPanel } from "./LinksPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";

const STATUS_LABEL: Record<TaskStatus, string> = { todo: "未着手", doing: "進行中", review: "確認待ち", done: "完了" };
const SAVE_DEBOUNCE_MS = 600;

type Member = { supabase_user_id: string; profiles: { display_name: string | null } | null };

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
  project,
  taskId,
  currentUserId,
  displayName,
  avatarUrl,
  onClose,
}: {
  client: SupabaseClient;
  project: Pick<Project, "id" | "team_id">;
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
    queryKey: ["team-members-lite", project.team_id],
    queryFn: async () => {
      const { data, error } = await client
        .from("team_members")
        .select("supabase_user_id, profiles(display_name)")
        .eq("team_id", project.team_id)
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
    void queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
  };

  const updateTask = useMutation({
    mutationFn: async (
      patch: Partial<
        Pick<
          Task,
          "title" | "description" | "status" | "priority" | "due_date" | "due_time" | "assigned_to" | "assigned_to_all" | "notified_at" | "reminder_minutes"
        >
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

  /** モバイルでソフトウェアキーボードが開いたまま固まる不具合を避けるため、閉じる前にフォーカスを外す。 */
  function closeModal() {
    (document.activeElement as HTMLElement | null)?.blur();
    onClose();
  }

  const deleteTask = useMutation({
    mutationFn: async () => {
      const { error } = await client.from("tasks").delete().eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
      closeModal();
    },
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  // 詳細本文: チャット形式。1行=1ブロックで発言者を明示し、自分の行しか書き換えられない。
  const blocksQueryKey = ["task-blocks", taskId];
  const blocksQuery = useQuery({
    queryKey: blocksQueryKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("task_page_blocks")
        .select("id,task_id,author_id,content,created_at,updated_at,profiles(display_name,avatar_url)")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as TaskPageBlock[];
    },
  });
  useRealtimeInvalidate(client, `task-blocks-${taskId}`, "task_page_blocks", `task_id=eq.${taskId}`, blocksQueryKey);

  const blocks = blocksQuery.data ?? [];

  const [composeDraft, setComposeDraft] = useState("");
  const [composeBlockId, setComposeBlockId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresencePayload[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<number | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const channel = client.channel(`task-presence-${taskId}`, { config: { presence: { key: currentUserId } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const values = Object.values(channel.presenceState()).flat() as unknown as PresencePayload[];
        setPresence(values.filter((p) => p.user_id !== currentUserId));
      })
      .subscribe();
    return () => {
      channelRef.current = null;
      void client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, currentUserId]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [blocks.length]);

  async function trackTyping(isEditing: boolean) {
    await channelRef.current?.track({
      user_id: currentUserId,
      display_name: displayName,
      avatar_url: avatarUrl,
      status: isEditing ? "editing" : "viewing",
      field: null,
      updated_at: new Date().toISOString(),
    } satisfies PresencePayload);
  }

  function onComposeChange(value: string) {
    setComposeDraft(value);
    void trackTyping(value.length > 0);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveDraft(value), SAVE_DEBOUNCE_MS);
  }

  async function saveDraft(content: string) {
    if (!content.trim()) return;
    if (composeBlockId) {
      await client.from("task_page_blocks").update({ content }).eq("id", composeBlockId);
    } else {
      const { data, error } = await client
        .from("task_page_blocks")
        .insert({ task_id: taskId, author_id: currentUserId, content })
        .select()
        .single();
      if (!error && data) setComposeBlockId(data.id);
    }
    void queryClient.invalidateQueries({ queryKey: blocksQueryKey });
  }

  async function submitBlock() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const content = composeDraft.trim();
    if (!content) return;
    if (composeBlockId) {
      await client.from("task_page_blocks").update({ content }).eq("id", composeBlockId);
    } else {
      await client.from("task_page_blocks").insert({ task_id: taskId, author_id: currentUserId, content });
    }
    setComposeDraft("");
    setComposeBlockId(null);
    void trackTyping(false);
    void queryClient.invalidateQueries({ queryKey: blocksQueryKey });
  }

  function onComposeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitBlock();
    }
  }

  function editOwnBlock(block: TaskPageBlock) {
    setComposeBlockId(block.id);
    setComposeDraft(block.content);
  }

  async function deleteBlock(id: string) {
    const { error } = await client.from("task_page_blocks").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    if (composeBlockId === id) {
      setComposeBlockId(null);
      setComposeDraft("");
    }
    void queryClient.invalidateQueries({ queryKey: blocksQueryKey });
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
          <button
            className="btn-icon"
            onClick={() => window.confirm("このタスクを削除しますか？") && deleteTask.mutate()}
            aria-label="タスクを削除"
          >
            <Trash2 size={16} />
          </button>
          <button className="btn-icon modal-close-btn" onClick={closeModal} aria-label="閉じる">
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
                  {p.display_name}が入力中
                </span>
              ))}
            </div>
          )}

          <div className="block-feed">
            {blocks.length === 0 && <div className="day-panel-empty">まだ記入がありません。下の欄から書き始めてください。</div>}
            {blocks.map((block) => (
              <div className={`block-row ${block.author_id === currentUserId ? "mine" : ""}`} key={block.id}>
                <Avatar name={block.profiles?.display_name ?? "?"} url={block.profiles?.avatar_url} />
                <div className="block-body">
                  <div className="block-meta">
                    <span className="block-author">{block.profiles?.display_name ?? "メンバー"}</span>
                    <span className="block-time">{relativeTime(block.updated_at)}</span>
                  </div>
                  <p className="block-text">{block.content}</p>
                </div>
                {block.author_id === currentUserId && (
                  <div className="block-actions">
                    <button className="btn-icon" aria-label="編集" onClick={() => editOwnBlock(block)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn-icon" aria-label="削除" onClick={() => void deleteBlock(block.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div ref={feedEndRef} />
          </div>

          <div className="compose-row">
            {composeDraft.length > 0 && <Avatar name={displayName} url={avatarUrl} />}
            <textarea
              className={`compose-input ${composeDraft.length > 0 ? "" : "no-badge"}`}
              value={composeDraft}
              onChange={(e) => onComposeChange(e.target.value)}
              onKeyDown={onComposeKeyDown}
              placeholder="続きを書く（Enterで送信 / Shift+Enterで改行）"
            />
            <button className="btn btn-primary btn-sm" disabled={!composeDraft.trim()} onClick={() => void submitBlock()}>
              送信
            </button>
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
          </div>

          <div className="field">
            <label>通知タイミング</label>
            <select
              value={task.reminder_minutes ?? "default"}
              onChange={(e) => updateTask.mutate({ reminder_minutes: e.target.value === "default" ? null : Number(e.target.value) })}
            >
              <option value="default">チームの既定値を使う</option>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>担当者</label>
            <select
              value={task.assigned_to_all ? "all" : task.assigned_to ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "all") updateTask.mutate({ assigned_to: null, assigned_to_all: true });
                else updateTask.mutate({ assigned_to: value || null, assigned_to_all: false });
              }}
            >
              <option value="">未割り当て</option>
              <option value="all">全員</option>
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
          <AttachmentsPanel client={client} taskId={taskId} projectId={project.id} userId={currentUserId} />
        </aside>
      </div>

      {/* スクロール位置に関係なく常に押せる、大きめの閉じるボタン(スマホ表示のみ)。 */}
      <button className="mobile-close-fab" onClick={closeModal} aria-label="タスク詳細を閉じる">
        <X size={18} />
        閉じる
      </button>
    </Modal>
  );
}
