import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Group, Task, TaskStatus } from "../../types";
import { TaskDetail } from "./TaskDetail";

const labels: Record<TaskStatus, string> = { todo: "未着手", doing: "進行中", review: "確認待ち", done: "完了" };

export function TaskList({ group, currentUserId, displayName }: { group: Group; currentUserId: string; displayName: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    void loadTasks();
    const channel = supabase.channel(`tasks-${group.id}`).on("postgres_changes", {
      event: "*", schema: "public", table: "tasks", filter: `group_id=eq.${group.id}`,
    }, () => void loadTasks()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [group.id]);

  async function loadTasks() {
    const { data } = await supabase.from("tasks").select("*").eq("group_id", group.id).order("created_at", { ascending: false });
    setTasks(data ?? []);
  }

  async function createTask() {
    if (!title.trim()) return;
    const { data, error } = await supabase.from("tasks").insert({
      group_id: group.id, title: title.trim(), status: "todo", priority: 2,
      created_by: currentUserId, updated_by: currentUserId,
    }).select().single();
    if (error || !data) return alert(error?.message ?? "作成に失敗しました");
    await supabase.from("task_pages").insert({ task_id: data.id, title: data.title, content: "", version: 1, updated_by: currentUserId });
    setTitle("");
    setSelectedId(data.id);
  }

  async function updateStatus(task: Task, status: TaskStatus) {
    await supabase.from("tasks").update({ status, updated_by: currentUserId }).eq("id", task.id);
  }

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return <section className="split-layout">
    <aside className="left-panel">
      <div className="create-row"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="新しいタスク" /><button onClick={() => void createTask()}>追加</button></div>
      <div className="kanban">
        {(Object.keys(labels) as TaskStatus[]).map((status) => <div className="column" key={status}>
          <h3>{labels[status]}</h3>
          {tasks.filter((t) => t.status === status).map((task) => <button key={task.id} className={`task-card ${selectedId === task.id ? "selected" : ""}`} onClick={() => setSelectedId(task.id)}>
            <strong>{task.title}</strong><span>{task.due_date ?? "期限なし"}</span>
            <select value={task.status} onClick={(e) => e.stopPropagation()} onChange={(e) => void updateStatus(task, e.target.value as TaskStatus)}>
              {(Object.keys(labels) as TaskStatus[]).map((s) => <option key={s} value={s}>{labels[s]}</option>)}
            </select>
          </button>)}
        </div>)}
      </div>
    </aside>
    <section className="right-panel">{selected ? <TaskDetail task={selected} currentUserId={currentUserId} displayName={displayName} groupId={group.id} /> : <div className="empty">タスクを選択してください。</div>}</section>
  </section>;
}
