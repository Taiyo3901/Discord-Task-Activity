import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { mintSupabaseJwt } from "../_shared/jwt.ts";

type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function avatarUrl(user: DiscordUser) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const fallbackIndex = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const clientId = Deno.env.get("DISCORD_CLIENT_ID");
  const clientSecret = Deno.env.get("DISCORD_CLIENT_SECRET");
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
  if (!clientId || !clientSecret || !jwtSecret) {
    return json({ error: "サーバー設定が不足しています（DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / SUPABASE_JWT_SECRET）。" }, 500);
  }

  let code: string | undefined;
  try {
    const body = await req.json();
    code = body?.code;
  } catch {
    return json({ error: "不正なリクエストです。" }, 400);
  }
  if (!code) return json({ error: "codeが必要です。" }, 400);

  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code }),
  });
  if (!tokenResponse.ok) {
    return json({ error: "Discordトークン交換に失敗しました。" }, 401);
  }
  const tokenData = (await tokenResponse.json()) as { access_token: string };

  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userResponse.ok) return json({ error: "Discordユーザー情報の取得に失敗しました。" }, 401);
  const discordUser = (await userResponse.json()) as DiscordUser;

  const admin = createAdminClient();

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("discord_user_id", discordUser.id)
    .maybeSingle();

  let profileId = existingProfile?.id as string | undefined;

  if (!profileId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `discord-${discordUser.id}@users.noreply.discord-task-activity.app`,
      email_confirm: true,
      user_metadata: { discord_user_id: discordUser.id },
    });
    if (createError || !created.user) return json({ error: createError?.message ?? "ユーザー作成に失敗しました。" }, 500);
    profileId = created.user.id;
  }

  const displayName = discordUser.global_name ?? discordUser.username;

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: profileId,
    display_name: displayName,
    avatar_url: avatarUrl(discordUser),
    discord_user_id: discordUser.id,
    discord_username: discordUser.username,
  });
  if (upsertError) return json({ error: upsertError.message }, 500);

  const jwt = await mintSupabaseJwt(profileId, jwtSecret);

  return json({
    supabase_access_token: jwt,
    supabase_expires_in: 21600,
    discord_access_token: tokenData.access_token,
    user: { id: profileId, display_name: displayName, avatar_url: avatarUrl(discordUser), discord_user_id: discordUser.id },
  });
});
