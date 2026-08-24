import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, File as FileIcon, Trash2, X } from "lucide-react";
import { useToast } from "../../components/ui/ToastProvider";

type Attachment = { id: string; original_file_name: string; file_path: string; uploaded_by: string; mime_type: string | null };

const FORBIDDEN = /\.(exe|bat|cmd|msi|apk|ipa)$/i;
const BUCKET = "task-files";

function isImage(mime: string | null) {
  return !!mime && mime.startsWith("image/");
}

function AttachmentThumb({
  client,
  attachment,
  onOpen,
}: {
  client: SupabaseClient;
  attachment: Attachment;
  onOpen: (url: string) => void;
}) {
  const { data: url } = useQuery({
    queryKey: ["attachment-preview", attachment.id],
    queryFn: async () => {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(attachment.file_path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 4 * 60 * 1000,
  });

  if (!url) return <div className="attachment-thumb attachment-thumb-loading" />;
  return (
    <button className="attachment-thumb" onClick={() => onOpen(url)} aria-label={`${attachment.original_file_name}をプレビュー`}>
      <img src={url} alt="" />
    </button>
  );
}

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
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const queryKey = ["attachments", taskId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("task_attachments")
        .select("id,original_file_name,file_path,uploaded_by,mime_type")
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
    const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (uploadError) {
      toast(uploadError.message, "error");
    } else {
      const { error } = await client
        .from("task_attachments")
        .insert({ task_id: taskId, uploaded_by: userId, bucket_name: BUCKET, file_path: path, original_file_name: file.name, mime_type: file.type || null, file_size: file.size });
      if (error) toast(error.message, "error");
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey });
  }

  async function previewFile(item: Attachment) {
    if (isImage(item.mime_type)) return;
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(item.file_path, 300);
    if (error || !data) return toast("プレビューURLの発行に失敗しました。", "error");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function downloadFile(item: Attachment) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(item.file_path, 60, { download: item.original_file_name });
    if (error || !data) return toast("ダウンロードURLの発行に失敗しました。", "error");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const remove = useMutation({
    mutationFn: async (item: Attachment) => {
      await client.storage.from(BUCKET).remove([item.file_path]);
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
      <div className="attachment-list">
        {(query.data ?? []).map((a) => (
          <div className="attachment-row" key={a.id}>
            {isImage(a.mime_type) ? (
              <AttachmentThumb client={client} attachment={a} onOpen={(url) => setLightbox({ url, name: a.original_file_name })} />
            ) : (
              <div className="attachment-icon">
                <FileIcon size={16} />
              </div>
            )}
            <button className="file-button" onClick={() => void previewFile(a)} title="プレビュー">
              {a.original_file_name}
            </button>
            <div className="attachment-actions">
              <button className="btn-icon" aria-label="ダウンロード" onClick={() => void downloadFile(a)}>
                <Download size={14} />
              </button>
              {a.uploaded_by === userId && (
                <button className="btn-icon" aria-label="削除" onClick={() => remove.mutate(a)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="lightbox-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.name} className="lightbox-image" />
          <button className="btn-icon lightbox-close" onClick={() => setLightbox(null)} aria-label="閉じる">
            <X size={20} />
          </button>
        </div>
      )}
    </section>
  );
}
