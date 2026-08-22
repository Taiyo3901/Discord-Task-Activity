import { useDraggable } from "@dnd-kit/core";
import { MessageSquare, Link2, Paperclip } from "lucide-react";
import type { TaskSummary } from "../../types";
import { Avatar } from "../../components/ui/Avatar";

const PRIORITY_LABEL: Record<number, string> = { 1: "低", 2: "中", 3: "高", 4: "緊急" };

function dueState(dueDate: string | null): "overdue" | "soon" | null {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  const soonThreshold = new Date();
  soonThreshold.setDate(soonThreshold.getDate() + 2);
  if (dueDate <= soonThreshold.toISOString().slice(0, 10)) return "soon";
  return null;
}

export function TaskCard({ task, onOpen }: { task: TaskSummary; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { task } });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const due = dueState(task.due_date);

  return (
    <button
      ref={setNodeRef}
      className={`task-card ${isDragging ? "dragging" : ""}`}
      data-priority={task.priority}
      style={style}
      onClick={onOpen}
      {...listeners}
      {...attributes}
    >
      <span className="task-card-title">{task.title}</span>
      <div className="task-card-meta">
        <span className={`badge badge-priority-${task.priority}`}>{PRIORITY_LABEL[task.priority] ?? task.priority}</span>
        {task.due_date && <span className={`due-pill ${due ?? ""}`}>{task.due_date}</span>}
      </div>
      <div className="task-card-footer">
        <div className="task-card-stats">
          {task.comment_count > 0 && (
            <span>
              <MessageSquare size={12} /> {task.comment_count}
            </span>
          )}
          {task.link_count > 0 && (
            <span>
              <Link2 size={12} /> {task.link_count}
            </span>
          )}
          {task.attachment_count > 0 && (
            <span>
              <Paperclip size={12} /> {task.attachment_count}
            </span>
          )}
        </div>
        {task.assigned_to && <Avatar name={task.assignee_display_name} url={task.assignee_avatar_url} />}
      </div>
    </button>
  );
}
