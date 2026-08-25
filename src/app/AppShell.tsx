import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, CalendarDays, Users, Settings, UserCircle, LogOut, Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { AppSession, Team } from "../types";
import { Avatar } from "../components/ui/Avatar";
import { useToast } from "../components/ui/ToastProvider";
import { Board } from "../features/board/Board";
import { EventsView } from "../features/events/EventsView";
import { MembersView } from "../features/members/MembersView";
import { TeamSettingsView } from "../features/settings/TeamSettingsView";
import { AccountView } from "../features/account/AccountView";

type Tab = "board" | "events" | "members" | "settings" | "account";

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "board", label: "ボード", icon: LayoutGrid },
  { id: "events", label: "カレンダー", icon: CalendarDays },
  { id: "members", label: "メンバー", icon: Users },
  { id: "settings", label: "設定", icon: Settings },
  { id: "account", label: "アカウント", icon: UserCircle },
];

export function AppShell({ session, onSignOut }: { session: AppSession; onSignOut: () => void }) {
  const { client, userId, displayName, avatarUrl } = session;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("board");
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [mobileNewTeamOpen, setMobileNewTeamOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("dta_sidebar_collapsed") === "1");

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("dta_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  }

  const teamsQuery = useQuery({
    queryKey: ["teams", userId],
    queryFn: async () => {
      const { data, error } = await client.from("team_members").select("teams(*)").eq("supabase_user_id", userId).eq("status", "active");
      if (error) throw error;
      const teams = (data ?? []).map((row) => row.teams as unknown as Team).filter(Boolean);
      teams.sort((a, b) => a.name.localeCompare(b.name));
      return teams;
    },
  });

  const teams = teamsQuery.data ?? [];
  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? teams[0] ?? null;

  /**
   * Activityを開いたまま招待されても、リロードせずに参加できるようにする。
   * invitesの変更をリアルタイム購読し、届いたら自分宛の招待を承諾してチーム一覧を更新する。
   * RLSで自分に関係する招待しか届かないため、フィルタなしで購読して問題ない。
   * WebSocket切断など不測の事態に備え、定期ポーリングも並走させる。
   */
  useEffect(() => {
    async function acceptAndRefresh() {
      try {
        await client.rpc("accept_my_discord_invites");
      } catch {
        // 失敗しても次回のポーリング/イベントで再試行されるため無視する
      }
      void queryClient.invalidateQueries({ queryKey: ["teams", userId] });
    }

    const channel = client
      .channel(`invites-watch-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invites" }, () => void acceptAndRefresh())
      .subscribe();

    const interval = window.setInterval(() => void acceptAndRefresh(), 90_000);

    return () => {
      void client.removeChannel(channel);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const createTeam = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await client.rpc("create_team_with_owner", { team_name: name });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      setNewTeamName("");
      setMobileNewTeamOpen(false);
      setCurrentTeamId(id);
      void queryClient.invalidateQueries({ queryKey: ["teams", userId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "チーム作成に失敗しました。", "error"),
  });

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">
            <LayoutGrid size={15} />
          </span>
          <span className="sidebar-brand-text">Task Activity</span>
          <button
            className="btn-icon sidebar-collapse-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
            title={sidebarCollapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <div className="group-switcher">
          <span className="sidebar-label">チーム</span>
          <select value={currentTeam?.id ?? ""} onChange={(e) => setCurrentTeamId(e.target.value)}>
            <option value="" disabled>
              チームを選択
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="new-group-row">
            <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="新しいチーム名" />
            <button
              className="btn btn-ghost"
              disabled={!newTeamName.trim() || createTeam.isPending}
              onClick={() => void createTeam.mutate(newTeamName.trim())}
            >
              作成
            </button>
          </div>
        </div>

        <nav className="nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
              title={sidebarCollapsed ? label : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
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
          <div className="topbar-mobile-groups">
            <select
              className="mobile-group-select"
              value={currentTeam?.id ?? ""}
              onChange={(e) => setCurrentTeamId(e.target.value)}
            >
              <option value="" disabled>
                チームを選択
              </option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="btn-icon"
              aria-label="新しいチームを作成"
              onClick={() => setMobileNewTeamOpen((v) => !v)}
            >
              <Plus size={16} />
            </button>
            <button className="btn-icon" onClick={onSignOut} aria-label="ログアウト" title="ログアウト">
              <LogOut size={16} />
            </button>
          </div>

          {mobileNewTeamOpen && (
            <div className="topbar-mobile-new-group">
              <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="新しいチーム名" />
              <button
                className="btn btn-primary btn-sm"
                disabled={!newTeamName.trim() || createTeam.isPending}
                onClick={() => void createTeam.mutate(newTeamName.trim())}
              >
                作成
              </button>
            </div>
          )}
        </header>

        <div className="view-body">
          {tab === "account" ? (
            <AccountView session={session} />
          ) : !currentTeam ? (
            <div className="empty-state">
              <p>チームがありません。新しいチームを作成してください。</p>
            </div>
          ) : (
            <>
              {tab === "board" && (
                <Board client={client} team={currentTeam} currentUserId={userId} displayName={displayName} avatarUrl={avatarUrl} />
              )}
              {tab === "events" && (
                <EventsView client={client} team={currentTeam} currentUserId={userId} displayName={displayName} avatarUrl={avatarUrl} />
              )}
              {tab === "members" && (
                <MembersView client={client} team={currentTeam} currentUserId={userId} displayName={displayName} avatarUrl={avatarUrl} />
              )}
              {tab === "settings" && <TeamSettingsView client={client} team={currentTeam} currentUserId={userId} />}
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
