import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { EventItem, Group } from "../../types";
export function EventsPanel({ group, currentUserId }: { group: Group; currentUserId: string }) {
  const [items, setItems] = useState<EventItem[]>([]); const [title, setTitle] = useState(""); const [startAt, setStartAt] = useState("");
  useEffect(() => { void load(); const c = supabase.channel(`events-${group.id}`).on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `group_id=eq.${group.id}` }, () => void load()).subscribe(); return () => { void supabase.removeChannel(c); }; }, [group.id]);
  async function load() { const { data } = await supabase.from("events").select("*").eq("group_id", group.id).order("start_at"); setItems(data ?? []); }
  async function add() { if (!title.trim() || !startAt) return; await supabase.from("events").insert({ group_id: group.id, title: title.trim(), start_at: new Date(startAt).toISOString(), created_by: currentUserId, updated_by: currentUserId }); setTitle(""); setStartAt(""); }
  return <section className="panel"><h2>予定</h2><div className="create-row events-row"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="予定名" /><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /><button onClick={() => void add()}>追加</button></div><div className="list">{items.map((e) => <article className="list-card" key={e.id}><strong>{e.title}</strong><span>{new Date(e.start_at).toLocaleString("ja-JP")}</span></article>)}</div></section>;
}
