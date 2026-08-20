import type { AppSession } from "../types";
import { createActivityClient } from "./supabase";
import { authenticateWithDiscord, authorizeWithDiscord, isInsideDiscord } from "./discordActivity";
import type { DiscordSDK } from "@discord/embedded-app-sdk";

const STORAGE_KEY = "dta_activity_session";

type ExchangeResponse = {
  supabase_access_token: string;
  supabase_expires_in: number;
  discord_access_token: string;
  user: { id: string; display_name: string; avatar_url: string | null; discord_user_id: string };
};

type StoredSession = { jwt: string; expiresAt: number; user: ExchangeResponse["user"] };

function functionsBaseUrl() {
  if (isInsideDiscord()) return "/supabase/functions/v1";
  return `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1`;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.expiresAt <= Date.now() + 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearDiscordActivitySession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

async function exchangeCodeForSession(code: string): Promise<ExchangeResponse> {
  const response = await fetch(`${functionsBaseUrl()}/discord-token-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error ?? "Discordログインに失敗しました。");
  return data as ExchangeResponse;
}

function toAppSession(stored: StoredSession): AppSession {
  return {
    client: createActivityClient(stored.jwt),
    userId: stored.user.id,
    displayName: stored.user.display_name,
    avatarUrl: stored.user.avatar_url,
  };
}

/**
 * Discord Activity内での認証フロー一式: authorize() → Edge Functionでcode交換
 * (client_secretはサーバー側のみ) → authenticate() でSDKセッションも確立 → 自前JWTを
 * sessionStorageへ保持する。
 */
export async function establishDiscordActivitySession(sdk: DiscordSDK): Promise<AppSession> {
  const cached = readStoredSession();
  if (cached) return toAppSession(cached);

  const code = await authorizeWithDiscord(sdk);
  const exchanged = await exchangeCodeForSession(code);
  await authenticateWithDiscord(sdk, exchanged.discord_access_token);

  const stored: StoredSession = {
    jwt: exchanged.supabase_access_token,
    expiresAt: Date.now() + exchanged.supabase_expires_in * 1000,
    user: exchanged.user,
  };
  writeStoredSession(stored);
  return toAppSession(stored);
}
