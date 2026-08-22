import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, XCircle } from "lucide-react";
import type { Group, Role } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { Avatar } from "../../components/ui/Avatar";

type Member = {
  id: string;
  supabase_user_id: string;
  role: Role;
  profiles: { display_name: string | null; discord_username: string | null; avatar_url: string | null } | null;
};
type Invite = { id: string; discord_user_id: string; role: Role; status: string };

export function MembersView({ client, group, currentUserId }: { client: SupabaseClient; group: Group; currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [discordId, setDiscordId] = useState("");
  const [role, setRole] = useState<Role>("member");

  const membersKey = ["members", group.id];
  const invitesKey = ["invites", group.id];

  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("group_members")
        .select("id,supabase_user_id,role,profiles(display_name,discord_username,avatar_url)")
        .eq("group_id", group.id)
        .eq("status", "active");
      if (error) throw error;
      return (data ?? []) as unknown as Member[];
    },
  });

  const invitesQuery = useQuery({
    queryKey: invitesKey,
    queryFn: async () => {
      const { data, error } = await client.from("invites").select("id,discord_user_id,role,status").eq("group_id", group.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invite[];
    },
  });

  const members = membersQuery.data ?? [];
  const myRole = members.find((m) => m.supabase_user_id === currentUserId)?.role;
  const isAdmin = myRole === "owner" || myRole === "admin";

  const invite = useMutation({
    mutationFn: async () => {
      const { error } = await client.from("invites").insert({
        group_id: group.id,
        discord_user_id: discordId.trim(),
        role,
        status: "pending",
        invited_by: currentUserId,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDiscordId("");
      void queryClient.invalidateQueries({ queryKey: invitesKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "招待に失敗しました。", "error"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "取消に失敗しました。", "error"),
  });

  const changeRole = useMutation({
    mutationFn: async ({ id, nextRole }: { id: string; nextRole: Role }) => {
      const { error } = await client.from("group_members").update({ role: nextRole }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: membersKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("group_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: membersKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  const leaveGroup = useMutation({
    mutationFn: async () => {
      const { error } = await client.rpc("leave_group", { gid: group.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast("グループから脱退しました。", "success");
      void queryClient.invalidateQueries({ queryKey: ["groups", currentUserId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "脱退に失敗しました。", "error"),
  });

  return (
    <section className="panel">
      <h2>メンバー</h2>

      {isAdmin && (
        <div className="toolbar-row">
          <input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="Discord User ID" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
          <button className="btn btn-primary" disabled={!discordId.trim()} onClick={() => invite.mutate()}>
            招待
          </button>
        </div>
      )}

      <div className="panel-section">
        <h3>参加中</h3>
        <div className="list">
          {members.map((m) => (
            <article className="list-card" key={m.id}>
              <div className="list-card-main">
                <Avatar name={m.profiles?.display_name ?? m.profiles?.discord_username} url={m.profiles?.avatar_url} />
                <div>
                  <div className="list-card-title">{m.profiles?.display_name ?? m.profiles?.discord_username ?? "メンバー"}</div>
                  <div className="list-card-sub">@{m.profiles?.discord_username ?? "unknown"}</div>
                </div>
              </div>
              <div className="list-card-actions">
                {isAdmin && m.supabase_user_id !== currentUserId ? (
                  <select value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, nextRole: e.target.value as Role })}>
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                ) : (
                  <span className={`role-badge role-${m.role}`}>{m.role}</span>
                )}
                {isAdmin && m.supabase_user_id !== currentUserId && (
                  <button className="btn-icon" aria-label="削除" onClick={() => window.confirm("このメンバーを削除しますか？") && removeMember.mutate(m.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="panel-section">
          <h3>招待履歴</h3>
          <div className="list">
            {(invitesQuery.data ?? []).map((i) => (
              <article className="list-card" key={i.id}>
                <div className="list-card-main">
                  <div>
                    <div className="list-card-title monospace">{i.discord_user_id}</div>
                    <div className="list-card-sub">
                      {i.role} / {i.status}
                    </div>
                  </div>
                </div>
                {i.status === "pending" && (
                  <button className="btn-icon" aria-label="招待を取消" onClick={() => cancelInvite.mutate(i.id)}>
                    <XCircle size={14} />
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="panel-section">
        <button className="btn btn-danger" onClick={() => window.confirm("このグループから脱退しますか？") && leaveGroup.mutate()}>
          グループから脱退
        </button>
      </div>
    </section>
  );
}
