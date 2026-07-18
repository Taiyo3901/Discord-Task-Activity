import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
type Comment = { id: string; body: string; created_at: string; profiles: { display_name: string | null } | null };
export function CommentsPanel({ taskId, userId }: { taskId: string; userId: string }) {
  const [items, setItems] = useState<Comment[]>([]); const [body, setBody] = useState("");
  useEffect(() => { void load(); const c = supabase.channel(`comments-${taskId}`).on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` }, () => void load()).subscribe(); return () => { void supabase.removeChannel(c); }; }, [taskId]);
  async function load() { const { data } = await supabase.from("task_comments").select("id,body,created_at,profiles(display_name)").eq("task_id", taskId).order("created_at"); setItems((data ?? []) as unknown as Comment[]); }
  async function add() { if (!body.trim()) return; const { error } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: userId, body: body.trim() }); if (!error) setBody(""); }
  return <section className="mini-panel"><h3>コメント</h3><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="コメント" /><button onClick={() => void add()}>投稿</button><div className="compact-list">{items.map((c) => <div key={c.id}><strong>{c.profiles?.display_name ?? "メンバー"}</strong><p>{c.body}</p></div>)}</div></section>;
}
