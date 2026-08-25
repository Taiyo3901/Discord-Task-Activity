import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, ChevronLeft, ChevronRight, Pencil, Plus, Square, Trash2 } from "lucide-react";
import type { EventItem, Team, TaskSummary } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { useRealtimeInvalidate } from "../../hooks/useRealtimeInvalidate";
import { REMINDER_OPTIONS } from "../../lib/reminders";
import { TaskModal } from "../tasks/TaskModal";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const POPUP_WIDTH = 340;
const POPUP_MAX_HEIGHT = 480;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function sameDay(a: Date, b: Date) {
  return dateKey(a) === dateKey(b);
}
function combineDateTime(date: Date, time: string): Date {
  const [h, m] = time ? time.split(":").map(Number) : [0, 0];
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0);
}
/** 時刻が00:00ぴったりの場合は「時刻未指定」を表す規約として扱う（終日予定など）。 */
function timeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timeInputValue(iso: string | null): string {
  return timeLabel(iso) ?? "";
}
function eventTimeRangeLabel(event: EventItem): string {
  const start = timeLabel(event.start_at);
  const end = timeLabel(event.end_at);
  if (!start && !end) return "終日";
  if (start && end) return `${start}〜${end}`;
  return start ?? `〜${end}`;
}

/** 週の始まり(日曜)から42マス(6週)分のグリッドを作る。前後月の日で埋める。 */
function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    return date;
  });
}

function computePopupPosition(rect: DOMRect) {
  let left = rect.left;
  if (left + POPUP_WIDTH > window.innerWidth - 12) left = window.innerWidth - POPUP_WIDTH - 12;
  if (left < 12) left = 12;

  let top = rect.bottom + 8;
  if (top + POPUP_MAX_HEIGHT > window.innerHeight - 12) {
    top = rect.top - POPUP_MAX_HEIGHT - 8;
  }
  if (top < 12) top = 12;

  return { top, left };
}

type EventFormState = { title: string; startTime: string; endTime: string; description: string; reminderMinutes: number | null };
const EMPTY_FORM: EventFormState = { title: "", startTime: "10:00", endTime: "", description: "", reminderMinutes: null };
type CalendarTask = Pick<
  TaskSummary,
  "id" | "group_id" | "title" | "description" | "status" | "priority" | "due_date" | "due_time" | "project_name" | "assigned_to" | "assigned_to_all"
>;
type FilterType = "all" | "events" | "tasks";
type TeamMemberLite = { supabase_user_id: string; profiles: { display_name: string | null; discord_username: string | null } | null };

export function EventsView({
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

  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [openTask, setOpenTask] = useState<{ id: string; projectId: string } | null>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<EventFormState>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EventFormState>(EMPTY_FORM);

  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterType, setFilterType] = useState<FilterType>("all");

  const membersQuery = useQuery({
    queryKey: ["team-members-lite", team.id],
    queryFn: async () => {
      const { data, error } = await client
        .from("team_members")
        .select("supabase_user_id, profiles(display_name, discord_username)")
        .eq("team_id", team.id)
        .eq("status", "active");
      if (error) throw error;
      return (data ?? []) as unknown as TeamMemberLite[];
    },
  });
  const teamMembers = membersQuery.data ?? [];

  const queryKey = ["events", team.id];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client.from("events").select("*").eq("team_id", team.id).order("start_at");
      if (error) throw error;
      return (data ?? []) as EventItem[];
    },
  });
  useRealtimeInvalidate(client, `events-${team.id}`, "events", `team_id=eq.${team.id}`, queryKey);

  const events = query.data ?? [];

  const projectIdsQuery = useQuery({
    queryKey: ["project-ids", team.id],
    queryFn: async () => {
      const { data, error } = await client.from("groups").select("id").eq("team_id", team.id);
      if (error) throw error;
      return (data ?? []).map((p) => p.id as string);
    },
  });
  const projectIds = projectIdsQuery.data ?? [];

  const tasksQueryKey = ["calendar-tasks", team.id];
  const tasksQuery = useQuery({
    queryKey: tasksQueryKey,
    queryFn: async () => {
      const { data, error } = await client
        .from("task_summary")
        .select("id,group_id,title,description,status,priority,due_date,due_time,project_name,assigned_to,assigned_to_all")
        .eq("team_id", team.id)
        .not("due_date", "is", null)
        .order("due_date");
      if (error) throw error;
      return (data ?? []) as CalendarTask[];
    },
  });
  useRealtimeInvalidate(
    client,
    `calendar-tasks-${team.id}`,
    "tasks",
    `group_id=in.(${projectIds.length > 0 ? projectIds.join(",") : "00000000-0000-0000-0000-000000000000"})`,
    tasksQueryKey,
  );

  const dueTasks = tasksQuery.data ?? [];

  /**
   * 予定(events)には担当者の概念が無いため、アカウントでのフィルターは効かせない
   * (種別フィルターで「タスクのみ」を選んだ場合のみ非表示にする)。
   */
  const filteredEvents = useMemo(() => {
    if (filterType === "tasks") return [];
    return events;
  }, [events, filterType]);

  const filteredTasks = useMemo(() => {
    if (filterType === "events") return [];
    return dueTasks.filter((t) => filterAssignee === "all" || t.assigned_to === filterAssignee || t.assigned_to_all);
  }, [dueTasks, filterType, filterAssignee]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const event of filteredEvents) {
      const key = dateKey(new Date(event.start_at));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [filteredEvents]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of filteredTasks) {
      if (!task.due_date) continue;
      const list = map.get(task.due_date) ?? [];
      list.push(task);
      map.set(task.due_date, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.due_time ?? "").localeCompare(b.due_time ?? ""));
    return map;
  }, [filteredTasks]);

  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const selectedEvents = selectedDate ? eventsByDay.get(dateKey(selectedDate)) ?? [] : [];
  const selectedTasks = selectedDate ? tasksByDay.get(dateKey(selectedDate)) ?? [] : [];

  function goToMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }
  function goToToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  function openDayPopup(date: Date, cellEl: HTMLElement) {
    setSelectedDate(date);
    setPopupPos(computePopupPosition(cellEl.getBoundingClientRect()));
    setAddOpen(false);
    setEditingId(null);
    setAddForm(EMPTY_FORM);
  }
  function closePopup() {
    setSelectedDate(null);
    setPopupPos(null);
    setAddOpen(false);
    setEditingId(null);
  }

  useEffect(() => {
    if (!selectedDate) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closePopup();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const add = useMutation({
    mutationFn: async () => {
      if (!selectedDate) return;
      const startAt = combineDateTime(selectedDate, addForm.startTime);
      const endAt = addForm.endTime ? combineDateTime(selectedDate, addForm.endTime) : null;
      const { error } = await client.from("events").insert({
        team_id: team.id,
        title: addForm.title.trim(),
        description: addForm.description.trim() || null,
        start_at: startAt.toISOString(),
        end_at: endAt ? endAt.toISOString() : null,
        reminder_minutes: addForm.reminderMinutes,
        created_by: currentUserId,
        updated_by: currentUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAddForm(EMPTY_FORM);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "追加に失敗しました。", "error"),
  });

  const update = useMutation({
    mutationFn: async (event: EventItem) => {
      if (!selectedDate) return;
      const startAt = combineDateTime(selectedDate, editForm.startTime);
      const endAt = editForm.endTime ? combineDateTime(selectedDate, editForm.endTime) : null;
      const { error } = await client
        .from("events")
        .update({
          title: editForm.title.trim(),
          description: editForm.description.trim() || null,
          start_at: startAt.toISOString(),
          end_at: endAt ? endAt.toISOString() : null,
          reminder_minutes: editForm.reminderMinutes,
          notified_at: null,
          updated_by: currentUserId,
        })
        .eq("id", event.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "更新に失敗しました。", "error"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast(error instanceof Error ? error.message : "削除に失敗しました。", "error"),
  });

  const monthLabel = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;
  const selectedLabel = selectedDate ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日（${WEEKDAYS[selectedDate.getDay()]}）` : "";

  return (
    <div className="calendar-page">
      <section className="calendar-card">
        <header className="calendar-header">
          <div className="calendar-title">
            <CalendarDays size={18} />
            <h2>{monthLabel}</h2>
          </div>
          <div className="calendar-nav">
            <button className="btn-icon" onClick={() => goToMonth(-1)} aria-label="前の月">
              <ChevronLeft size={18} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={goToToday}>
              今日
            </button>
            <button className="btn-icon" onClick={() => goToMonth(1)} aria-label="次の月">
              <ChevronRight size={18} />
            </button>
          </div>
        </header>

        <div className="calendar-filters">
          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} aria-label="担当者でフィルター">
            <option value="all">担当者: すべて</option>
            {teamMembers.map((m) => (
              <option key={m.supabase_user_id} value={m.supabase_user_id}>
                {m.profiles?.display_name ?? m.profiles?.discord_username ?? "メンバー"}
              </option>
            ))}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as FilterType)} aria-label="種別でフィルター">
            <option value="all">種別: すべて</option>
            <option value="events">予定のみ</option>
            <option value="tasks">タスクのみ</option>
          </select>
          {(filterAssignee !== "all" || filterType !== "all") && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFilterAssignee("all");
                setFilterType("all");
              }}
            >
              フィルター解除
            </button>
          )}
        </div>

        <div className="calendar-weekdays">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`calendar-weekday ${i === 0 ? "sun" : ""} ${i === 6 ? "sat" : ""}`}>
              {w}
            </div>
          ))}
        </div>

        <div className="calendar-grid">
          {grid.map((date) => {
            const key = dateKey(date);
            const inMonth = date.getMonth() === cursor.getMonth();
            const isToday = sameDay(date, today);
            const isSelected = selectedDate ? sameDay(date, selectedDate) : false;
            const dayEvents = eventsByDay.get(key) ?? [];
            const dayTasks = tasksByDay.get(key) ?? [];
            const weekday = date.getDay();
            const visibleEvents = dayEvents.slice(0, 3);
            const visibleTasks = dayTasks.slice(0, Math.max(0, 3 - visibleEvents.length));
            const hidden = dayEvents.length + dayTasks.length - visibleEvents.length - visibleTasks.length;

            return (
              <button
                key={key}
                className={`calendar-cell ${inMonth ? "" : "outside"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                onClick={(e) => openDayPopup(date, e.currentTarget)}
              >
                <span className={`calendar-date ${weekday === 0 ? "sun" : ""} ${weekday === 6 ? "sat" : ""}`}>{date.getDate()}</span>
                <span className="calendar-events">
                  {visibleEvents.map((event) => (
                    <span key={`e-${event.id}`} className="calendar-event-pill">
                      <span className="calendar-event-title">{event.title}</span>
                    </span>
                  ))}
                  {visibleTasks.map((task) => (
                    <span
                      key={`t-${task.id}`}
                      className="calendar-task-pill"
                      data-priority={task.priority}
                      title={`${task.project_name} / ${task.title}`}
                    >
                      <span className="calendar-task-project">{task.project_name}</span>
                      <span className={`calendar-event-title ${task.status === "done" ? "done" : ""}`}>{task.title}</span>
                    </span>
                  ))}
                  {hidden > 0 && <span className="calendar-more">+{hidden}件</span>}
                </span>
                {dayEvents.length === 0 && dayTasks.length === 0 && (
                  <span className="calendar-add-hint">
                    <Plus size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {selectedDate && popupPos && (
        <>
          <div className="day-popup-backdrop" onMouseDown={closePopup} />
          <div className="day-popup" style={{ top: popupPos.top, left: popupPos.left }}>
            <header className="day-panel-header">
              <div>
                <div className="day-panel-date">{selectedLabel}</div>
                <div className="day-panel-count">
                  {selectedEvents.length}件の予定{selectedTasks.length > 0 && ` ・ ${selectedTasks.length}件の期限タスク`}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setEditingId(null);
                  setAddOpen((v) => !v);
                  setAddForm(EMPTY_FORM);
                }}
              >
                <Plus size={14} />
                追加
              </button>
            </header>

            {addOpen && (
              <div className="day-panel-form">
                <input
                  autoFocus
                  value={addForm.title}
                  onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="予定名"
                />
                <div className="event-time-row">
                  <label>
                    <span>開始</span>
                    <input
                      type="time"
                      value={addForm.startTime}
                      onChange={(e) => setAddForm((f) => ({ ...f, startTime: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>終了</span>
                    <input
                      type="time"
                      value={addForm.endTime}
                      onChange={(e) => setAddForm((f) => ({ ...f, endTime: e.target.value }))}
                    />
                  </label>
                </div>
                <p className="field-hint">時刻を空欄にすると「終日」として扱われます。</p>
                <textarea
                  className="event-description"
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="詳細・メモ（任意）"
                />
                <label className="event-reminder-field">
                  <span>通知タイミング</span>
                  <select
                    value={addForm.reminderMinutes ?? "default"}
                    onChange={(e) => setAddForm((f) => ({ ...f, reminderMinutes: e.target.value === "default" ? null : Number(e.target.value) }))}
                  >
                    <option value="default">チームの既定値を使う</option>
                    {REMINDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="day-panel-form-actions">
                  <button className="btn btn-primary" disabled={!addForm.title.trim() || add.isPending} onClick={() => add.mutate()}>
                    保存
                  </button>
                  <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>
                    キャンセル
                  </button>
                </div>
              </div>
            )}

            <div className="day-panel-list">
              {selectedEvents.length === 0 && !addOpen && <div className="day-panel-empty">この日の予定はまだありません。</div>}

              {selectedEvents.map((event) =>
                editingId === event.id ? (
                  <div className="day-panel-form" key={event.id}>
                    <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="予定名" />
                    <div className="event-time-row">
                      <label>
                        <span>開始</span>
                        <input
                          type="time"
                          value={editForm.startTime}
                          onChange={(e) => setEditForm((f) => ({ ...f, startTime: e.target.value }))}
                        />
                      </label>
                      <label>
                        <span>終了</span>
                        <input
                          type="time"
                          value={editForm.endTime}
                          onChange={(e) => setEditForm((f) => ({ ...f, endTime: e.target.value }))}
                        />
                      </label>
                    </div>
                    <p className="field-hint">時刻を空欄にすると「終日」として扱われます。</p>
                    <textarea
                      className="event-description"
                      value={editForm.description}
                      onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="詳細・メモ（任意）"
                    />
                    <label className="event-reminder-field">
                      <span>通知タイミング</span>
                      <select
                        value={editForm.reminderMinutes ?? "default"}
                        onChange={(e) => setEditForm((f) => ({ ...f, reminderMinutes: e.target.value === "default" ? null : Number(e.target.value) }))}
                      >
                        <option value="default">チームの既定値を使う</option>
                        {REMINDER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="day-panel-form-actions">
                      <button className="btn btn-primary" onClick={() => update.mutate(event)}>
                        保存
                      </button>
                      <button className="btn btn-ghost" onClick={() => setEditingId(null)}>
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <article className="day-event-card" key={event.id}>
                    <div className="day-event-main">
                      <div className="day-event-top">
                        <span className="day-event-time">{eventTimeRangeLabel(event)}</span>
                        <span className="day-event-title">{event.title}</span>
                      </div>
                      {event.description && <p className="day-event-desc">{event.description}</p>}
                    </div>
                    <div className="day-event-actions">
                      <button
                        className="btn-icon"
                        aria-label="編集"
                        onClick={() => {
                          setAddOpen(false);
                          setEditingId(event.id);
                          setEditForm({
                            title: event.title,
                            startTime: timeInputValue(event.start_at),
                            endTime: timeInputValue(event.end_at),
                            description: event.description ?? "",
                            reminderMinutes: event.reminder_minutes,
                          });
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button className="btn-icon" aria-label="削除" onClick={() => window.confirm("この予定を削除しますか？") && remove.mutate(event.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ),
              )}
            </div>

            {selectedTasks.length > 0 && (
              <div className="day-panel-tasks">
                <h4>期限タスク</h4>
                <div className="day-panel-list">
                  {selectedTasks.map((task) => (
                    <button
                      className="day-task-card"
                      key={task.id}
                      data-priority={task.priority}
                      onClick={() => setOpenTask({ id: task.id, projectId: task.group_id })}
                    >
                      {task.status === "done" ? <CheckSquare size={15} /> : <Square size={15} />}
                      <div className="day-event-main">
                        <div className="day-event-top">
                          {task.due_time && <span className="day-event-time">{task.due_time.slice(0, 5)}</span>}
                          <span className={`day-event-title ${task.status === "done" ? "done" : ""}`}>{task.title}</span>
                        </div>
                        <span className="day-task-project">{task.project_name}</span>
                        {task.description && <p className="day-event-desc">{task.description}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {openTask && (
        <TaskModal
          client={client}
          project={{ id: openTask.projectId, team_id: team.id }}
          taskId={openTask.id}
          currentUserId={currentUserId}
          displayName={displayName}
          avatarUrl={avatarUrl}
          onClose={() => setOpenTask(null)}
        />
      )}
    </div>
  );
}
