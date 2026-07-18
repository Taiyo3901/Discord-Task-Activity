import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import type { Group, Profile } from "../../types";
import { TaskList } from "../tasks/TaskList";
import { EventsPanel } from "../events/EventsPanel";
import { MembersPanel } from "../members/MembersPanel";

type Tab = "tasks" | "events" | "members";

export function Dashboard({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [tab, setTab] = useState<Tab>("tasks");

  useEffect(() => { void load(); }, [session.user.id]);

  async function load() {
    const { data: p } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    setProfile(p);
    await acceptInvites(p?.discord_user_id ?? null);
    await loadGroups();
  }

  async function acceptInvites(discordUserId: string | null) {
    if (!discordUserId) return;
    await supabase.rpc("accept_my_discord_invites");
  }

  async function loadGroups() {
    const { data } = await supabase
      .from("group_members")
      .select("groups(*)")
      .eq("supabase_user_id", session.user.id)
      .eq("status", "active");

    const next = (data ?? [])
      .map((row) => row.groups as unknown as Group)
      .filter(Boolean);
    setGroups(next);
    setCurrentGroup((previous) => next.find((g) => g.id === previous?.id) ?? next[0] ?? null);
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    const { data, error } = await supabase.rpc("create_group_with_owner", { group_name: newGroupName.trim() });
    if (error) return alert(error.message);
    setNewGroupName("");
    await loadGroups();
    if (data) setCurrentGroup((await supabase.from("groups").select("*").eq("id", data).single()).data);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><h1>Task Activity</h1><p>{profile?.display_name ?? session.user.email}</p></div>
        <button className="ghost-button" onClick={() => void supabase.auth.signOut()}>ログアウト</button>
      </header>

      <section className="group-panel">
        <select value={currentGroup?.id ?? ""} onChange={(e) => setCurrentGroup(groups.find((g) => g.id === e.target.value) ?? null)}>
          <option value="">グループ未選択</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新しいグループ名" />
        <button onClick={() => void createGroup()}>作成</button>
      </section>

      {!currentGroup ? <section className="empty card">グループを作成してください。</section> : <>
        <nav className="tabs">
          {(["tasks", "events", "members"] as Tab[]).map((value) => (
            <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
              {value === "tasks" ? "タスク" : value === "events" ? "予定" : "メンバー"}
            </button>
          ))}
        </nav>
        {tab === "tasks" && <TaskList group={currentGroup} currentUserId={session.user.id} displayName={profile?.display_name ?? "メンバー"} />}
        {tab === "events" && <EventsPanel group={currentGroup} currentUserId={session.user.id} />}
        {tab === "members" && <MembersPanel group={currentGroup} currentUserId={session.user.id} />}
      </>}
    </main>
  );
}
