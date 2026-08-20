import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useToast } from "../../components/ui/ToastProvider";

type Link = { id: string; url: string; label: string | null; created_by: string };

export function LinksPanel({ client, taskId, userId }: { client: SupabaseClient; taskId: string; userId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const queryKey = ["links", taskId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client.from("task_links").select("id,url,label,created_by").eq("task_id", taskId).order("created_at");
      if (error) throw error;
      return (data ?? []) as Link[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("正しいURLを入力してください。");
      }
      if (parsed.protocol !== "https:") throw new Error("https:// のURLのみ登録できます。");
      const { error } = await client.from("task_links").insert({ task_id: taskId, url, label: label || null, created_by: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      setUrl("");
      setLabel("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "追加に失敗しました。", "error"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("task_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  return (
    <section className="mini-panel">
      <h3>関連リンク</h3>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
      <button className="btn btn-ghost" onClick={() => add.mutate()}>
        追加
      </button>
      <ul className="compact-list">
        {(query.data ?? []).map((l) => (
          <li className="compact-row" key={l.id}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label || l.url}
            </a>
            {l.created_by === userId && (
              <button className="btn-icon" onClick={() => remove.mutate(l.id)} aria-label="削除">
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
