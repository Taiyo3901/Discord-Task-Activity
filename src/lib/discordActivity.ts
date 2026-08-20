import { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";
import type { Types } from "@discord/embedded-app-sdk";

let sdk: DiscordSDK | null = null;

export function isInsideDiscord() {
  return window.location.hostname.endsWith("discordsays.com");
}

/**
 * DiscordのActivity iframe内でのみSDKを初期化する。外部通信(Supabase)は
 * URL Mappingsで"/supabase"にマッピングされたホストへpatchUrlMappingsが
 * fetch/WebSocketを書き換えることで通す。ブラウザ単体起動時は何もしない。
 */
export async function initDiscordActivity(): Promise<DiscordSDK | null> {
  if (!isInsideDiscord()) return null;

  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!clientId || !supabaseUrl) return null;

  patchUrlMappings([{ prefix: "/supabase", target: new URL(supabaseUrl).host }]);

  try {
    sdk = new DiscordSDK(clientId);
    await sdk.ready();
    return sdk;
  } catch (error) {
    console.info("Discord Activity外で起動しました。", error);
    sdk = null;
    return null;
  }
}

export function getDiscordSdk() {
  return sdk;
}

export async function authorizeWithDiscord(activeSdk: DiscordSDK) {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string;
  const scope: Types.OAuthScopes[] = ["identify"];
  const { code } = await activeSdk.commands.authorize({ client_id: clientId, response_type: "code", prompt: "none", scope });
  return code;
}

export async function authenticateWithDiscord(activeSdk: DiscordSDK, discordAccessToken: string) {
  return activeSdk.commands.authenticate({ access_token: discordAccessToken });
}
