import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Link = { id: string; url: string; label: string | null };
export function LinksPanel({ taskId, userId }: { taskId: string; userId: string }) {
  const [links, setLinks] = useState<Link[]>([]); const [url, setUrl] = useState(""); const [label, setLabel] = useState("");
  useEffect(() => { void load(); }, [taskId]);
  async function load() { const { data } = await supabase.from("task_links").select("id,url,label").eq("task_id", taskId).order("created_at"); setLinks(data ?? []); }
  async function add() {
    let parsed: URL; try { parsed = new URL(url); } catch { return alert("正しいURLを入力してください"); }
    if (parsed.protocol !== "https:") return alert("https:// のURLのみ登録できます");
    const { error } = await supabase.from("task_links").insert({ task_id: taskId, url, label: label || null, created_by: userId });
    if (!error) { setUrl(""); setLabel(""); await load(); }
  }
  return <section className="mini-panel"><h3>関連リンク</h3><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /><button onClick={() => void add()}>追加</button><ul>{links.map((l) => <li key={l.id}><a href={l.url} target="_blank" rel="noreferrer">{l.label || l.url}</a></li>)}</ul></section>;
}
