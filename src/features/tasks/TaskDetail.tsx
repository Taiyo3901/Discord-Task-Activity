import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import type { PresencePayload, Task, TaskPage } from "../../types";
import { LinksPanel } from "./LinksPanel";
import { CommentsPanel } from "./CommentsPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";

export function TaskDetail({ task, currentUserId, displayName, groupId }: { task: Task; currentUserId: string; displayName: string; groupId: string }) {
  const [page, setPage] = useState<TaskPage | null>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"saved" | "editing" | "saving" | "conflict">("saved");
  const [presence, setPresence] = useState<PresencePayload[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    void loadPage();
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [task.id]);

  useEffect(() => {
    if (!page) return;
    const channel = supabase.channel(`task-page-${page.id}`, { config: { presence: { key: currentUserId } } });
    channelRef.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      const values = Object.values(channel.presenceState()).flat() as unknown as PresencePayload[];
      setPresence(values.filter((p) => p.user_id !== currentUserId));
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "task_pages", filter: `id=eq.${page.id}` }, (payload) => {
      const updated = payload.new as TaskPage;
      setPage((current) => {
        if (current && updated.version > current.version && stateRef.current === "saved") setDraft(updated.content);
        return updated;
      });
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") void track("viewing");
    });
    return () => { channelRef.current = null; void supabase.removeChannel(channel); };
  }, [page?.id, currentUserId]);

  async function loadPage() {
    const { data } = await supabase.from("task_pages").select("*").eq("task_id", task.id).single();
    if (data) { setPage(data); setDraft(data.content); setState("saved"); }
  }

  async function track(status: "viewing" | "editing") {
    await channelRef.current?.track({ user_id: currentUserId, display_name: displayName, status, field: status === "editing" ? "content" : null, updated_at: new Date().toISOString() } satisfies PresencePayload);
  }

  function onChange(value: string) {
    setDraft(value); setState("editing"); void track("editing");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void save(value), 3000);
  }

  async function save(value: string) {
    if (!page) return;
    setState("saving");
    const { data, error } = await supabase.from("task_pages").update({ content: value, version: page.version + 1, updated_by: currentUserId })
      .eq("id", page.id).eq("version", page.version).select().maybeSingle();
    if (error || !data) { setState("conflict"); return; }
    setPage(data); setDraft(data.content); setState("saved"); await track("viewing");
  }

  async function reloadLatest() {
    if (!page) return;
    const { data } = await supabase.from("task_pages").select("*").eq("id", page.id).single();
    if (data) { setPage(data); setDraft(data.content); setState("saved"); }
  }

  async function overwrite() {
    if (!page) return;
    const { data: latest } = await supabase.from("task_pages").select("version").eq("id", page.id).single();
    const { data } = await supabase.from("task_pages").update({ content: draft, version: (latest?.version ?? page.version) + 1, updated_by: currentUserId }).eq("id", page.id).select().single();
    if (data) { setPage(data); setState("saved"); }
  }

  return <article className="task-detail">
    <header className="detail-header"><div><h2>{task.title}</h2><p>ステータス: {task.status}</p></div><span className={`save-state ${state}`}>{state === "saved" ? "保存済み" : state === "editing" ? "編集中" : state === "saving" ? "保存中" : "競合あり"}</span></header>
    {presence.length > 0 && <div className="presence-box">{presence.map((p, i) => <span key={`${p.user_id}-${i}`}>{p.display_name} が{p.status === "editing" ? "入力中" : "閲覧中"}</span>)}</div>}
    {state === "conflict" && <div className="conflict-box"><p>他のメンバーが先に更新しました。編集中の内容は保持されています。</p><button onClick={() => void reloadLatest()}>最新版を見る</button><button onClick={() => void overwrite()}>自分の内容で上書き</button></div>}
    <textarea className="editor" value={draft} onChange={(e) => onChange(e.target.value)} placeholder="詳細、メモ、仕様を書いてください。" />
    <div className="detail-grid"><LinksPanel taskId={task.id} userId={currentUserId} /><AttachmentsPanel taskId={task.id} groupId={groupId} userId={currentUserId} /><CommentsPanel taskId={task.id} userId={currentUserId} /></div>
  </article>;
}
