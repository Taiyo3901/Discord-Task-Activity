import { DiscordSDK } from "@discord/embedded-app-sdk";

let discordSdk: DiscordSDK | null = null;

export async function initDiscordSdk(): Promise<DiscordSDK | null> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) return null;

  try {
    discordSdk = new DiscordSDK(clientId);
    await discordSdk.ready();
    return discordSdk;
  } catch (error) {
    console.info("通常ブラウザモードで起動しました。", error);
    discordSdk = null;
    return null;
  }
}

export function getDiscordSdk() {
  return discordSdk;
}
