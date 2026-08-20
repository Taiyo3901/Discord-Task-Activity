import { verifyDiscordSignature } from "../_shared/discordVerify.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const EPHEMERAL = 64;

type InteractionOption = { name: string; value?: string; options?: InteractionOption[] };
type Interaction = {
  type: number;
  guild_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { name: string; options?: InteractionOption[] };
};

function reply(content: string) {
  return new Response(
    JSON.stringify({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function findOption(options: InteractionOption[] | undefined, name: string) {
  return options?.find((option) => option.name === name)?.value;
}

Deno.serve(async (req) => {
  const publicKey = Deno.env.get("DISCORD_PUBLIC_KEY");
  if (!publicKey) return new Response("サーバー設定が不足しています。", { status: 500 });

  const signature = req.headers.get("X-Signature-Ed25519");
  const timestamp = req.headers.get("X-Signature-Timestamp");
  const rawBody = await req.text();

  if (!signature || !timestamp || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as Interaction;

  if (interaction.type === PING) {
    return new Response(JSON.stringify({ type: PONG }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (interaction.type !== APPLICATION_COMMAND || interaction.data?.name !== "task") {
    return reply("未対応のコマンドです。");
  }

  const subcommand = interaction.data.options?.[0];
  if (subcommand?.name !== "add") return reply("`/task add タイトル:...` の形式で使ってください。");

  const title = findOption(subcommand.options, "title")?.trim();
  const dueDate = findOption(subcommand.options, "due");
  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
  const guildId = interaction.guild_id;

  if (!title) return reply("タイトルを入力してください。");
  if (!guildId) return reply("サーバー内のチャンネルから実行してください。");
  if (!discordUserId) return reply("Discordユーザーを特定できませんでした。");

  const admin = createAdminClient();

  const { data: group } = await admin.from("groups").select("id, name").eq("discord_guild_id", guildId).maybeSingle();
  if (!group) return reply("このサーバーに連携されたグループがありません。Task Activityの「設定」からサーバーIDを連携してください。");

  const { data: profile } = await admin.from("profiles").select("id").eq("discord_user_id", discordUserId).maybeSingle();
  if (!profile) return reply("先にTask Activityでログインしてください。");

  const { data: membership } = await admin
    .from("group_members")
    .select("role")
    .eq("group_id", group.id)
    .eq("supabase_user_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership || !["owner", "admin", "member"].includes(membership.role)) {
    return reply("このグループでタスクを作成する権限がありません。");
  }

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .insert({
      group_id: group.id,
      title,
      status: "todo",
      priority: 2,
      due_date: dueDate || null,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select()
    .single();
  if (taskError || !task) return reply(`タスク作成に失敗しました: ${taskError?.message ?? "不明なエラー"}`);

  await admin.from("task_pages").insert({ task_id: task.id, title: task.title, content: "", version: 1, updated_by: profile.id });

  return reply(`✅ 「${group.name}」に「${title}」を追加しました。`);
});
