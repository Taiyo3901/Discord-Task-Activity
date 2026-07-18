import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Group, Role } from "../../types";
type Member = { id: string; role: Role; profiles: { display_name: string | null; discord_username: string | null } | null };
type Invite = { id: string; discord_user_id: string; role: Role; status: string };
export function MembersPanel({ group, currentUserId }: { group: Group; currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>([]); const [invites, setInvites] = useState<Invite[]>([]); const [discordId, setDiscordId] = useState(""); const [role, setRole] = useState<Role>("member");
  useEffect(() => { void load(); }, [group.id]);
  async function load() { const [m, i] = await Promise.all([supabase.from("group_members").select("id,role,profiles(display_name,discord_username)").eq("group_id", group.id).eq("status", "active"), supabase.from("invites").select("id,discord_user_id,role,status").eq("group_id", group.id).order("created_at", { ascending: false })]); setMembers((m.data ?? []) as unknown as Member[]); setInvites((i.data ?? []) as Invite[]); }
  async function invite() { if (!discordId.trim()) return; const { error } = await supabase.from("invites").insert({ group_id: group.id, discord_user_id: discordId.trim(), role, status: "pending", invited_by: currentUserId, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }); if (error) return alert(error.message); setDiscordId(""); await load(); }
  return <section className="panel"><h2>メンバー</h2><div className="create-row events-row"><input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="Discord User ID" /><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option></select><button onClick={() => void invite()}>招待</button></div><h3>参加中</h3><div className="list">{members.map((m) => <article className="list-card" key={m.id}><strong>{m.profiles?.display_name ?? m.profiles?.discord_username ?? "メンバー"}</strong><span>{m.role}</span></article>)}</div><h3>招待履歴</h3><div className="list">{invites.map((i) => <article className="list-card" key={i.id}><strong>{i.discord_user_id}</strong><span>{i.role} / {i.status}</span></article>)}</div></section>;
}
