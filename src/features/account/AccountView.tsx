import { useQuery } from "@tanstack/react-query";
import type { AppSession } from "../../types";
import { Avatar } from "../../components/ui/Avatar";

export function AccountView({ session }: { session: AppSession }) {
  const profileQuery = useQuery({
    queryKey: ["my-profile", session.userId],
    queryFn: async () => {
      const { data, error } = await session.client.from("profiles").select("*").eq("id", session.userId).single();
      if (error) throw error;
      return data;
    },
  });

  const profile = profileQuery.data;

  return (
    <section className="panel">
      <h2>Discordアカウント</h2>
      <p className="field-hint">このDiscordアカウントをログイン、共同編集メンバー招待、Activity連携に使用します。</p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
        <Avatar name={session.displayName} url={session.avatarUrl} size="lg" />
        <div>
          <div style={{ fontWeight: 700 }}>{profile?.display_name ?? session.displayName}</div>
          <div className="field-hint">@{profile?.discord_username ?? "-"}</div>
        </div>
      </div>

      <div className="field">
        <label>Discord User ID</label>
        <input readOnly className="monospace" value={profile?.discord_user_id ?? ""} />
        <p className="field-hint">メンバー招待の際、招待する側にこのIDを伝えてください。</p>
      </div>
    </section>
  );
}
