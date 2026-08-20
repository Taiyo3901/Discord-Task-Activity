import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useToast } from "../../components/ui/ToastProvider";

type Attachment = { id: string; original_file_name: string; file_path: string; uploaded_by: string };

const FORBIDDEN = /\.(exe|bat|cmd|msi|apk|ipa)$/i;

export function AttachmentsPanel({
  client,
  taskId,
  groupId,
  userId,
}: {
  client: SupabaseClient;
  taskId: string;
  groupId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const queryKey = ["attachments", taskId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("task_attachments")
        .select("id,original_file_name,file_path,uploaded_by")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Attachment[];
    },
  });

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast("10MB以下のファイルのみアップロードできます。", "error");
    if (FORBIDDEN.test(file.name)) return toast("この拡張子はアップロードできません。", "error");

    setBusy(true);
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${groupId}/${taskId}/${userId}/${crypto.randomUUID()}_${safe}`;
    const { error: uploadError } = await client.storage.from("task-files").upload(path, file, { upsert: false });
    if (uploadError) {
      toast(uploadError.message, "error");
    } else {
      const { error } = await client
        .from("task_attachments")
        .insert({ task_id: taskId, uploaded_by: userId, bucket_name: "task-files", file_path: path, original_file_name: file.name, mime_type: file.type || null, file_size: file.size });
      if (error) toast(error.message, "error");
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey });
  }

  async function download(item: Attachment) {
    const { data, error } = await client.storage.from("task-files").createSignedUrl(item.file_path, 60);
    if (error || !data) return toast("ダウンロードURLの発行に失敗しました。", "error");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const remove = useMutation({
    mutationFn: async (item: Attachment) => {
      await client.storage.from("task-files").remove([item.file_path]);
      const { error } = await client.from("task_attachments").delete().eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  return (
    <section className="mini-panel">
      <h3>添付ファイル</h3>
      <input type="file" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="compact-list">
        {(query.data ?? []).map((a) => (
          <div className="compact-row" key={a.id}>
            <button className="file-button" onClick={() => void download(a)}>
              {a.original_file_name}
            </button>
            {a.uploaded_by === userId && (
              <button className="btn-icon" onClick={() => remove.mutate(a)} aria-label="削除">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
