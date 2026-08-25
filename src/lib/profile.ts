import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Profile } from "../types";
import { browserAuthClient } from "./supabase";

type IdentityMeta = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getDiscordIdentity(user: User) {
  const identity = user.identities?.find((item) => item.provider === "discord");
  const meta = (identity?.identity_data ?? {}) as IdentityMeta;

  return {
    connected: Boolean(identity),
    id: text(meta.provider_id) ?? text(meta.sub) ?? text(identity?.id),
    username: text(meta.user_name) ?? text(meta.preferred_username) ?? text(meta.name) ?? text(meta.full_name),
    avatarUrl: text(meta.avatar_url),
    email: text(meta.email) ?? user.email ?? null,
  };
}

/** ブラウザフォールバック（Discord Activity外）のSupabase Auth OAuth完了直後に呼ぶ。 */
export async function syncCurrentUserProfile(user: User) {
  const discord = getDiscordIdentity(user);

  if (!discord.connected || !discord.id) {
    throw new Error("Discord Identityを取得できませんでした。Discordでログインし直してください。");
  }

  const displayName = discord.username ?? user.user_metadata.name ?? user.user_metadata.full_name ?? user.email ?? "Discordユーザー";

  const { error } = await browserAuthClient.from("profiles").upsert({
    id: user.id,
    email: discord.email,
    display_name: displayName,
    avatar_url: discord.avatarUrl ?? user.user_metadata.avatar_url ?? null,
    discord_user_id: discord.id,
    discord_username: discord.username,
  });

  if (error) throw error;
}

/** どちらの認証経路でも共通して使えるプロフィール取得。 */
export async function getMyProfile(client: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data } = await client.from("profiles").select("*").eq("id", userId).single();
  return data;
}

/** 自分のDiscord User ID宛のpending招待を承諾してチームへ参加する。ログイン完了時に毎回呼ぶ。 */
export async function acceptPendingInvites(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("accept_my_discord_invites");
  if (error) throw error;
  return (data as number | null) ?? 0;
}
