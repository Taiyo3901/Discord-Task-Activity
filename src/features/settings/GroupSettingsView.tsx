import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Group } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";

export function GroupSettingsView({ client, group, currentUserId }: { client: SupabaseClient; group: Group; currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(group.name);
  const [webhookUrl, setWebhookUrl] = useState(group.discord_webhook_url ?? "");
  const [guildId, setGuildId] = useState(group.discord_guild_id ?? "");

  useEffect(() => {
    setName(group.name);
    setWebhookUrl(group.discord_webhook_url ?? "");
    setGuildId(group.discord_guild_id ?? "");
  }, [group.id]);

  const roleQuery = useQuery({
    queryKey: ["my-role", group.id, currentUserId],
    queryFn: async () => {
      const { data } = await client.from("group_members").select("role").eq("group_id", group.id).eq("supabase_user_id", currentUserId).maybeSingle();
      return data?.role ?? null;
    },
  });
  const isAdmin = roleQuery.data === "owner" || roleQuery.data === "admin";

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await client
        .from("groups")
        .update({ name: name.trim(), discord_webhook_url: webhookUrl.trim() || null, discord_guild_id: guildId.trim() || null })
        .eq("id", group.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("設定を保存しました。", "success");
      void queryClient.invalidateQueries({ queryKey: ["groups", currentUserId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存に失敗しました。", "error"),
  });

  if (!isAdmin) {
    return (
      <section className="panel">
        <h2>設定</h2>
        <p className="field-hint">設定の変更にはオーナーまたは管理者権限が必要です。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>設定</h2>

      <div className="field">
        <label>グループ名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="panel-section">
        <h3>Discord連携</h3>

        <div className="field" style={{ marginTop: 12 }}>
          <label>通知用Webhook URL</label>
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." />
          <p className="field-hint">
            期限が近い/過ぎたタスクと開始間近の予定を、このWebhook宛に自動通知します。Discordのチャンネル設定 →
            連携サービス → ウェブフック → 新しいウェブフックから発行できます。
          </p>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>連携するサーバーID (Guild ID)</label>
          <input value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="123456789012345678" />
          <p className="field-hint">設定すると、そのサーバーの「/task add タイトル:...」コマンドからこのグループへタスクを追加できます。</p>
        </div>
      </div>

      <div className="panel-section">
        <button className="btn btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          保存
        </button>
      </div>
    </section>
  );
}
