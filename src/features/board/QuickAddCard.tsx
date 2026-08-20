import { useState } from "react";
import { Plus } from "lucide-react";

export function QuickAddCard({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  function submit() {
    if (!title.trim()) return;
    onAdd(title.trim());
    setTitle("");
  }

  if (!open) {
    return (
      <button className="quick-add-trigger" onClick={() => setOpen(true)}>
        <Plus size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        カードを追加
      </button>
    );
  }

  return (
    <div className="quick-add">
      <textarea
        autoFocus
        value={title}
        placeholder="タイトルを入力してEnter"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="quick-add-actions">
        <button className="btn btn-primary" onClick={submit}>
          追加
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
