import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import type { Project, Team, TaskStatus, TaskSummary } from "../../types";
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
  team,
  currentUserId,
  displayName,
  avatarUrl,
}: {
  client: SupabaseClient;
  team: Team;
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<TaskSummary | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const projectsQueryKey = ["projects", team.id];
  const projectsQuery = useQuery({
    queryKey: projectsQueryKey,
    queryFn: async () => {
      const { data, error } = await client.from("groups").select("*").eq("team_id", team.id).order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const projects = projectsQuery.data ?? [];
  const project = projects.find((p) => p.id === currentProjectId) ?? projects[0] ?? null;

  const createProject = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await client.rpc("create_project", { tid: team.id, project_name: name });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      setNewProjectName("");
      setCurrentProjectId(id);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "プロジェクト作成に失敗しました。", "error"),
  });

  const tasksQueryKey = ["tasks", project?.id];
  const tasksQuery = useQuery({
    queryKey: tasksQueryKey,
    queryFn: async () => {
      if (!project) return [];
      const { data, error } = await client.from("task_summary").select("*").eq("group_id", project.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaskSummary[];
    },
    enabled: !!project,
  });
  useRealtimeInvalidate(
    client,
    `tasks-${project?.id ?? "none"}`,
    "tasks",
    `group_id=eq.${project?.id ?? "00000000-0000-0000-0000-000000000000"}`,
    tasksQueryKey,
  );

  const tasks = tasksQuery.data ?? [];

  const createTask = useMutation({
    mutationFn: async (title: string) => {
      if (!project) throw new Error("プロジェクトが選択されていません。");
      const { data, error } = await client
        .from("tasks")
        .insert({ group_id: project.id, title, status: "todo", priority: 2, created_by: currentUserId, updated_by: currentUserId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tasksQueryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "タスク作成に失敗しました。", "error"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: TaskStatus }) => {
      const { error } = await client.from("tasks").update({ status, updated_by: currentUserId }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: tasksQueryKey }),
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
      <div className="project-switcher">
        <select value={project?.id ?? ""} onChange={(e) => setCurrentProjectId(e.target.value)}>
          <option value="" disabled>
            プロジェクトを選択
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="新しいプロジェクト名" />
        <button
          className="btn btn-ghost btn-sm"
          disabled={!newProjectName.trim() || createProject.isPending}
          onClick={() => void createProject.mutate(newProjectName.trim())}
        >
          <Plus size={14} />
          作成
        </button>
      </div>

      {!project ? (
        <div className="empty-state">
          <p>プロジェクトがありません。新しいプロジェクトを作成してください。</p>
        </div>
      ) : (
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
      )}

      {selectedTaskId && project && (
        <TaskModal
          client={client}
          project={project}
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
