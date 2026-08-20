import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!rawUrl || !rawAnonKey) {
  throw new Error("VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。");
}

export const supabaseUrl: string = rawUrl;
export const supabaseAnonKey: string = rawAnonKey;
const url = supabaseUrl;
const anonKey = supabaseAnonKey;

/**
 * ブラウザ単体で開いたとき（Discord Activityの外）向けのフォールバック。
 * 通常のSupabase Authセッション管理（Discord OAuthポップアップ）を使う。
 */
export const browserAuthClient = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/**
 * Discord Activity内でのカスタムJWTセッション用クライアント。
 * gotrueのセッション管理は使わず、Authorizationヘッダーとrealtime.setAuthへ
 * 手動でJWT(discord-token-exchange Edge Functionが発行)を適用する。
 */
export function createActivityClient(jwt: string): SupabaseClient {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  client.realtime.setAuth(jwt);
  return client;
}
