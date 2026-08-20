import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useToast } from "../../components/ui/ToastProvider";
import { useRealtimeInvalidate } from "../../hooks/useRealtimeInvalidate";

type Comment = { id: string; body: string; user_id: string; created_at: string; profiles: { display_name: string | null } | null };

export function CommentsPanel({ client, taskId, userId }: { client: SupabaseClient; taskId: string; userId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState("");
  const queryKey = ["comments", taskId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("task_comments")
        .select("id,body,user_id,created_at,profiles(display_name)")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Comment[];
    },
  });
  useRealtimeInvalidate(client, `comments-${taskId}`, "task_comments", `task_id=eq.${taskId}`, queryKey);

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await client.from("task_comments").insert({ task_id: taskId, user_id: userId, body: body.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "投稿に失敗しました。", "error"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("task_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  return (
    <section className="mini-panel">
      <h3>コメント</h3>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="コメント" />
      <button className="btn btn-ghost" disabled={!body.trim()} onClick={() => add.mutate()}>
        投稿
      </button>
      <div className="compact-list">
        {(query.data ?? []).map((c) => (
          <div className="compact-row" key={c.id}>
            <div>
              <strong>{c.profiles?.display_name ?? "メンバー"}</strong>
              <p>{c.body}</p>
            </div>
            {c.user_id === userId && (
              <button className="btn-icon" onClick={() => remove.mutate(c.id)} aria-label="削除">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
