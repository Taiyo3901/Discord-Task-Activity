import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
type Attachment = { id: string; original_file_name: string; file_path: string; mime_type: string | null };
const forbidden = /\.(exe|bat|cmd|msi|apk|ipa)$/i;
export function AttachmentsPanel({ taskId, groupId, userId }: { taskId: string; groupId: string; userId: string }) {
  const [items, setItems] = useState<Attachment[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { void load(); }, [taskId]);
  async function load() { const { data } = await supabase.from("task_attachments").select("id,original_file_name,file_path,mime_type").eq("task_id", taskId).order("created_at"); setItems(data ?? []); }
  async function upload(file: File | undefined) {
    if (!file) return; if (file.size > 10 * 1024 * 1024) return alert("MVPでは10MB以下に制限しています"); if (forbidden.test(file.name)) return alert("この拡張子はアップロードできません");
    setBusy(true); const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_"); const path = `${groupId}/${taskId}/${userId}/${crypto.randomUUID()}_${safe}`;
    const { error } = await supabase.storage.from("task-files").upload(path, file, { upsert: false });
    if (!error) await supabase.from("task_attachments").insert({ task_id: taskId, uploaded_by: userId, bucket_name: "task-files", file_path: path, original_file_name: file.name, mime_type: file.type || null, file_size: file.size });
    setBusy(false); await load();
  }
  async function download(item: Attachment) { const { data, error } = await supabase.storage.from("task-files").createSignedUrl(item.file_path, 60); if (!error && data) window.open(data.signedUrl, "_blank", "noopener,noreferrer"); }
  return <section className="mini-panel"><h3>添付ファイル</h3><input type="file" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} /><div className="compact-list">{items.map((a) => <button className="file-button" key={a.id} onClick={() => void download(a)}>{a.original_file_name}</button>)}</div></section>;
}
