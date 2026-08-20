import { useEffect, useRef, useState } from "react";
import type { AppSession } from "../types";
import { browserAuthClient } from "../lib/supabase";
import { syncCurrentUserProfile, getMyProfile } from "../lib/profile";
import { initDiscordActivity } from "../lib/discordActivity";
import { establishDiscordActivitySession } from "../lib/discordSession";
import { AppShell } from "../app/AppShell";

type Status = "loading" | "needs-browser-login" | "ready" | "error";

export function DiscordActivityGate() {
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<AppSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    const sdk = await initDiscordActivity();

    if (sdk) {
      try {
        const activitySession = await establishDiscordActivitySession(sdk);
        setSession(activitySession);
        setStatus("ready");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Discordログインに失敗しました。");
        setStatus("error");
      }
      return;
    }

    await bootstrapBrowserFallback();
  }

  async function bootstrapBrowserFallback() {
    const { data } = await browserAuthClient.auth.getSession();
    if (data.session?.user) {
      await loadBrowserSession();
    } else {
      setStatus("needs-browser-login");
    }

    browserAuthClient.auth.onAuthStateChange((_event, next) => {
      if (!next?.user) {
        setStatus("needs-browser-login");
        setSession(null);
        return;
      }
      window.setTimeout(() => void loadBrowserSession(), 0);
    });
  }

  async function loadBrowserSession() {
    const { data } = await browserAuthClient.auth.getUser();
    if (!data.user) return setStatus("needs-browser-login");

    try {
      await syncCurrentUserProfile(data.user);
      const profile = await getMyProfile(browserAuthClient, data.user.id);
      setSession({
        client: browserAuthClient,
        userId: data.user.id,
        displayName: profile?.display_name ?? data.user.email ?? "メンバー",
        avatarUrl: profile?.avatar_url ?? null,
      });
      setErrorMessage(null);
      setStatus("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "プロフィール同期に失敗しました。");
      await browserAuthClient.auth.signOut();
      setStatus("needs-browser-login");
    }
  }

  async function signInWithDiscordBrowser() {
    setErrorMessage(null);
    const { error } = await browserAuthClient.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
    if (error) setErrorMessage(error.message);
  }

  async function signOut() {
    if (session?.client === browserAuthClient) await browserAuthClient.auth.signOut();
    setSession(null);
    setStatus("needs-browser-login");
  }

  if (status === "loading") {
    return <div className="center">読み込み中...</div>;
  }

  if (status === "error") {
    return (
      <main className="login-screen">
        <section className="login-card">
          <h1>Discord Task Activity</h1>
          {errorMessage && <div className="auth-error">{errorMessage}</div>}
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </section>
      </main>
    );
  }

  if (status === "needs-browser-login") {
    return (
      <main className="login-screen">
        <section className="login-card">
          <h1>Discord Task Activity</h1>
          <p>Discordアカウントでログインし、タスク・予定・メモ・ファイルを共同管理します。</p>
          {errorMessage && <div className="auth-error">{errorMessage}</div>}
          <button className="btn btn-primary" onClick={() => void signInWithDiscordBrowser()}>
            Discordでログイン
          </button>
        </section>
      </main>
    );
  }

  if (!session) return <div className="center">読み込み中...</div>;

  return <AppShell session={session} onSignOut={() => void signOut()} />;
}
