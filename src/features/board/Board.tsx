import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import type { Group, TaskStatus, TaskSummary } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { useRealtimeInvalidate } from "../../hooks/useRealtimeInvalidate";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { QuickAddCard } from "./QuickAddCard";
import { TaskModal } from "../tasks/TaskModal";

const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "未着手" },
  { id: "doing", label: "進行中" },
  { id: "review", label: "確認待ち" },
  { id: "done", label: "完了" },
];

export function Board({
  client,
  group,
  currentUserId,
  displayName,
  avatarUrl,
}: {
  client: SupabaseClient;
  group: Group;
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<TaskSummary | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const queryKey = ["tasks", group.id];
  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client.from("task_summary").select("*").eq("group_id", group.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaskSummary[];
    },
  });
  useRealtimeInvalidate(client, `tasks-${group.id}`, "tasks", `group_id=eq.${group.id}`, queryKey);

  const tasks = tasksQuery.data ?? [];

  const createTask = useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await client
        .from("tasks")
        .insert({ group_id: group.id, title, status: "todo", priority: 2, created_by: currentUserId, updated_by: currentUserId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "タスク作成に失敗しました。", "error"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: TaskStatus }) => {
      const { error } = await client.from("tasks").update({ status, updated_by: currentUserId }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  function onDragStart(event: DragStartEvent) {
    setDraggingTask((event.active.data.current?.task as TaskSummary) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDraggingTask(null);
    const status = event.over?.id as TaskStatus | undefined;
    const task = event.active.data.current?.task as TaskSummary | undefined;
    if (!status || !task || task.status === status) return;
    updateStatus.mutate({ taskId: task.id, status });
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="board">
          {STATUSES.map(({ id, label }) => {
            const columnTasks = tasks.filter((t) => t.status === id);
            return (
              <Column key={id} status={id} label={label} count={columnTasks.length}>
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={() => setSelectedTaskId(task.id)} />
                ))}
                {id === "todo" && <QuickAddCard onAdd={(title) => createTask.mutate(title)} />}
              </Column>
            );
          })}
        </div>
        <DragOverlay>{draggingTask && <TaskCard task={draggingTask} onOpen={() => {}} />}</DragOverlay>
      </DndContext>

      {selectedTaskId && (
        <TaskModal
          client={client}
          group={group}
          taskId={selectedTaskId}
          currentUserId={currentUserId}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </>
  );
}
