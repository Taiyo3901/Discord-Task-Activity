import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, CalendarDays, Users, Settings, UserCircle, LogOut, Plus } from "lucide-react";
import type { AppSession, Group } from "../types";
import { Avatar } from "../components/ui/Avatar";
import { useToast } from "../components/ui/ToastProvider";
import { Board } from "../features/board/Board";
import { EventsView } from "../features/events/EventsView";
import { MembersView } from "../features/members/MembersView";
import { GroupSettingsView } from "../features/settings/GroupSettingsView";
import { AccountView } from "../features/account/AccountView";

type Tab = "board" | "events" | "members" | "settings" | "account";

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "board", label: "ボード", icon: LayoutGrid },
  { id: "events", label: "予定", icon: CalendarDays },
  { id: "members", label: "メンバー", icon: Users },
  { id: "settings", label: "設定", icon: Settings },
  { id: "account", label: "アカウント", icon: UserCircle },
];

export function AppShell({ session, onSignOut }: { session: AppSession; onSignOut: () => void }) {
  const { client, userId, displayName, avatarUrl } = session;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("board");
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [mobileNewGroupOpen, setMobileNewGroupOpen] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ["groups", userId],
    queryFn: async () => {
      const { data, error } = await client.from("group_members").select("groups(*)").eq("supabase_user_id", userId).eq("status", "active");
      if (error) throw error;
      const groups = (data ?? []).map((row) => row.groups as unknown as Group).filter(Boolean);
      groups.sort((a, b) => a.name.localeCompare(b.name));
      return groups;
    },
  });

  const groups = groupsQuery.data ?? [];
  const currentGroup = groups.find((g) => g.id === currentGroupId) ?? groups[0] ?? null;

  const createGroup = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await client.rpc("create_group_with_owner", { group_name: name });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      setNewGroupName("");
      setMobileNewGroupOpen(false);
      setCurrentGroupId(id);
      void queryClient.invalidateQueries({ queryKey: ["groups", userId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "グループ作成に失敗しました。", "error"),
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">
            <LayoutGrid size={15} />
          </span>
          Task Activity
        </div>

        <div className="group-switcher">
          <span className="sidebar-label">グループ</span>
          <select value={currentGroup?.id ?? ""} onChange={(e) => setCurrentGroupId(e.target.value)}>
            <option value="" disabled>
              グループを選択
            </option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="new-group-row">
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新しいグループ名" />
            <button
              className="btn btn-ghost"
              disabled={!newGroupName.trim() || createGroup.isPending}
              onClick={() => void createGroup.mutate(newGroupName.trim())}
            >
              作成
            </button>
          </div>
        </div>

        <nav className="nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <Avatar name={displayName} url={avatarUrl} />
          <span className="user-name">{displayName}</span>
          <button className="btn-icon" onClick={onSignOut} aria-label="ログアウト" title="ログアウト">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{currentGroup?.name ?? "グループ未選択"}</h1>
            <p className="topbar-subtitle">{TABS.find((t) => t.id === tab)?.label}</p>
          </div>

          <div className="topbar-mobile-groups">
            <select
              className="mobile-group-select"
              value={currentGroup?.id ?? ""}
              onChange={(e) => setCurrentGroupId(e.target.value)}
            >
              <option value="" disabled>
                グループを選択
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              className="btn-icon"
              aria-label="新しいグループを作成"
              onClick={() => setMobileNewGroupOpen((v) => !v)}
            >
              <Plus size={16} />
            </button>
            <button className="btn-icon" onClick={onSignOut} aria-label="ログアウト" title="ログアウト">
              <LogOut size={16} />
            </button>
          </div>

          {mobileNewGroupOpen && (
            <div className="topbar-mobile-new-group">
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新しいグループ名" />
              <button
                className="btn btn-primary btn-sm"
                disabled={!newGroupName.trim() || createGroup.isPending}
                onClick={() => void createGroup.mutate(newGroupName.trim())}
              >
                作成
              </button>
            </div>
          )}
        </header>

        <div className="view-body">
          {tab === "account" ? (
            <AccountView session={session} />
          ) : !currentGroup ? (
            <div className="empty-state">
              <p>グループがありません。新しいグループを作成してください。</p>
            </div>
          ) : (
            <>
              {tab === "board" && <Board client={client} group={currentGroup} currentUserId={userId} displayName={displayName} />}
              {tab === "events" && <EventsView client={client} group={currentGroup} currentUserId={userId} />}
              {tab === "members" && <MembersView client={client} group={currentGroup} currentUserId={userId} />}
              {tab === "settings" && <GroupSettingsView client={client} group={currentGroup} currentUserId={userId} />}
            </>
          )}
        </div>
      </div>

      <nav className="mobile-tabbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`mobile-tab-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
