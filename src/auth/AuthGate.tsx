import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { Dashboard } from "../features/dashboard/Dashboard";

function discordIdentity(user: User) {
  const identity = user.identities?.find((item) => item.provider === "discord");
  const meta = (identity?.identity_data ?? {}) as Record<string, unknown>;
  return {
    id: String(meta.provider_id ?? meta.sub ?? identity?.id ?? "") || null,
    username: String(meta.user_name ?? meta.preferred_username ?? meta.name ?? "") || null,
    avatar: String(meta.avatar_url ?? user.user_metadata.avatar_url ?? "") || null,
  };
}

async function syncProfile(user: User) {
  const discord = discordIdentity(user);
  const displayName =
    user.user_metadata.name ??
    user.user_metadata.full_name ??
    discord.username ??
    user.email ??
    "ユーザー";

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
    display_name: displayName,
    avatar_url: discord.avatar,
    discord_user_id: discord.id,
    discord_username: discord.username,
  });

  if (error) console.error("プロフィール同期に失敗しました", error);
}

export function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await syncProfile(data.session.user);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) void syncProfile(nextSession.user);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(provider: "discord" | "google") {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) alert(error.message);
  }

  if (loading) return <div className="center">読み込み中...</div>;

  if (!session) {
    return (
      <main className="login">
        <section className="login-card">
          <h1>Discord Task Activity</h1>
          <p>Discord内で予定、タスク、メモ、ファイルを共有する小規模チーム向けアプリです。</p>
          <button className="primary-button" onClick={() => void signIn("discord")}>Discordでログイン</button>
          <button className="secondary-button" onClick={() => void signIn("google")}>Googleでログイン</button>
        </section>
      </main>
    );
  }

  return <Dashboard session={session} />;
}
