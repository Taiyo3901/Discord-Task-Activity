import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import type { EventItem, Group } from "../../types";
import { useToast } from "../../components/ui/ToastProvider";
import { useRealtimeInvalidate } from "../../hooks/useRealtimeInvalidate";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function sameDay(a: Date, b: Date) {
  return dateKey(a) === dateKey(b);
}
function toLocalDateTimeInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toTimeLabel(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

export function EventsView({ client, group, currentUserId }: { client: SupabaseClient; group: Group; currentUserId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));

  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addTime, setAddTime] = useState("10:00");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStartAt, setEditStartAt] = useState("");

  const queryKey = ["events", group.id];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await client.from("events").select("*").eq("group_id", group.id).order("start_at");
      if (error) throw error;
      return (data ?? []) as EventItem[];
    },
  });
  useRealtimeInvalidate(client, `events-${group.id}`, "events", `group_id=eq.${group.id}`, queryKey);

  const events = query.data ?? [];

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const event of events) {
      const key = dateKey(new Date(event.start_at));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [events]);

  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const selectedEvents = eventsByDay.get(dateKey(selectedDate)) ?? [];

  function goToMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }
  function goToToday() {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }
  function selectDay(date: Date) {
    setSelectedDate(date);
    setAddOpen(false);
    setEditingId(null);
  }

  const add = useMutation({
    mutationFn: async () => {
      const [h, m] = addTime.split(":").map(Number);
      const startAt = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h || 0, m || 0);
      const { error } = await client.from("events").insert({
        group_id: group.id,
        title: addTitle.trim(),
        start_at: startAt.toISOString(),
        created_by: currentUserId,
        updated_by: currentUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAddTitle("");
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "追加に失敗しました。", "error"),
  });

  const update = useMutation({
    mutationFn: async (event: EventItem) => {
      const { error } = await client
        .from("events")
        .update({ title: editTitle.trim(), start_at: new Date(editStartAt).toISOString(), updated_by: currentUserId })
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
  const selectedLabel = `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日（${WEEKDAYS[selectedDate.getDay()]}）`;

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
            const isSelected = sameDay(date, selectedDate);
            const dayEvents = eventsByDay.get(key) ?? [];
            const weekday = date.getDay();
            const visible = dayEvents.slice(0, 3);
            const hidden = dayEvents.length - visible.length;

            return (
              <button
                key={key}
                className={`calendar-cell ${inMonth ? "" : "outside"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                onClick={() => selectDay(date)}
              >
                <span className={`calendar-date ${weekday === 0 ? "sun" : ""} ${weekday === 6 ? "sat" : ""}`}>{date.getDate()}</span>
                <span className="calendar-events">
                  {visible.map((event) => (
                    <span key={event.id} className="calendar-event-pill">
                      <span className="calendar-event-time">{toTimeLabel(event.start_at)}</span>
                      <span className="calendar-event-title">{event.title}</span>
                    </span>
                  ))}
                  {hidden > 0 && <span className="calendar-more">+{hidden}件</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="day-panel">
        <header className="day-panel-header">
          <div>
            <div className="day-panel-date">{selectedLabel}</div>
            <div className="day-panel-count">{selectedEvents.length}件の予定</div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditingId(null);
              setAddOpen((v) => !v);
            }}
          >
            <Plus size={14} />
            追加
          </button>
        </header>

        {addOpen && (
          <div className="day-panel-form">
            <input autoFocus value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="予定名" />
            <input type="time" value={addTime} onChange={(e) => setAddTime(e.target.value)} />
            <div className="day-panel-form-actions">
              <button className="btn btn-primary" disabled={!addTitle.trim() || add.isPending} onClick={() => add.mutate()}>
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
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="予定名" />
                <input type="datetime-local" value={editStartAt} onChange={(e) => setEditStartAt(e.target.value)} />
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
                <span className="day-event-time">{toTimeLabel(event.start_at)}</span>
                <span className="day-event-title">{event.title}</span>
                <div className="day-event-actions">
                  <button
                    className="btn-icon"
                    aria-label="編集"
                    onClick={() => {
                      setAddOpen(false);
                      setEditingId(event.id);
                      setEditTitle(event.title);
                      setEditStartAt(toLocalDateTimeInput(event.start_at));
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
      </aside>
    </div>
  );
}
