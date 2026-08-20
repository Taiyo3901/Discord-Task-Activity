import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import type { EventItem, Group } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { useRealtimeInvalidate } from "../../hooks/useRealtimeInvalidate";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventsView({ client, group, currentUserId }: { client: SupabaseClient; group: Group; currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStartAt, setEditStartAt] = useState("");

  const queryKey = ["events", group.id];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client.from("events").select("*").eq("group_id", group.id).order("start_at");
      if (error) throw error;
      return (data ?? []) as EventItem[];
    },
  });
  useRealtimeInvalidate(client, `events-${group.id}`, "events", `group_id=eq.${group.id}`, queryKey);

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await client
        .from("events")
        .insert({ group_id: group.id, title: title.trim(), start_at: new Date(startAt).toISOString(), created_by: currentUserId, updated_by: currentUserId });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setStartAt("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "追加に失敗しました。", "error"),
  });

  const update = useMutation({
    mutationFn: async (event: EventItem) => {
      const { error } = await client
        .from("events")
        .update({ title: editTitle.trim(), start_at: new Date(editStartAt).toISOString(), updated_by: currentUserId })
        .eq("id", event.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  return (
    <section className="panel">
      <h2>予定</h2>
      <div className="toolbar-row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="予定名" />
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        <button className="btn btn-primary" disabled={!title.trim() || !startAt} onClick={() => add.mutate()}>
          追加
        </button>
      </div>

      <div className="list">
        {(query.data ?? []).map((event) =>
          editingId === event.id ? (
            <article className="list-card" key={event.id}>
              <div className="toolbar-row" style={{ margin: 0, flex: 1 }}>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                <input type="datetime-local" value={editStartAt} onChange={(e) => setEditStartAt(e.target.value)} />
              </div>
              <div className="list-card-actions">
                <button className="btn btn-primary" onClick={() => update.mutate(event)}>
                  保存
                </button>
                <button className="btn btn-ghost" onClick={() => setEditingId(null)}>
                  キャンセル
                </button>
              </div>
            </article>
          ) : (
            <article className="list-card" key={event.id}>
              <div className="list-card-main">
                <div>
                  <div className="list-card-title">{event.title}</div>
                  <div className="list-card-sub">{new Date(event.start_at).toLocaleString("ja-JP")}</div>
                </div>
              </div>
              <div className="list-card-actions">
                <button
                  className="btn-icon"
                  aria-label="編集"
                  onClick={() => {
                    setEditingId(event.id);
                    setEditTitle(event.title);
                    setEditStartAt(toLocalInput(event.start_at));
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button className="btn-icon" aria-label="削除" onClick={() => window.confirm("この予定を削除しますか？") && remove.mutate(event.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ),
        )}
        {(query.data ?? []).length === 0 && <div className="empty-state">予定はまだありません。</div>}
      </div>
    </section>
  );
}
