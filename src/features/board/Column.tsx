import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { TaskStatus } from "../../types";

export function Column({ status, label, count, children }: { status: TaskStatus; label: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section ref={setNodeRef} className={`board-column ${isOver ? "drag-over" : ""}`}>
      <header className="board-column-header">
        <span>{label}</span>
        <span className="board-column-count">{count}</span>
      </header>
      <div className="board-column-list">{children}</div>
    </section>
  );
}
