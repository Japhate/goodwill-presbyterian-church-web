import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit, Trash, Copy, CheckCircle, Circle, CalendarHeart, Clock, CalendarDays } from "lucide-react";
import { format, parseISO } from "date-fns";
import { groupBy } from "lodash";

const formatTime = (timeString) => {
  if (!timeString) return "";
  const [hourValue, minuteValue = "0"] = String(timeString).split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return timeString;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const formatTimeRange = (startTime, endTime) => {
  const startLabel = formatTime(startTime);
  const endLabel = formatTime(endTime);
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || "";
};

const getMonthSortValue = (monthGroup = "") => {
  if (monthGroup === "Ongoing Events") return -1;
  const parsed = new Date(`${monthGroup} 1`);
  return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
};

export default function WorshipEventList({ events, onEdit, onDelete, onAddNew, onDuplicate }) {
  const formatDate = (dateString) => {
    if (!dateString) return 'No date';
    try {
      return format(parseISO(dateString), 'MMM d, yyyy');
    } catch {
      return 'Invalid date';
    }
  };
  const sortedEvents = [...events].sort((a, b) => {
    const monthSort = getMonthSortValue(a.month_group) - getMonthSortValue(b.month_group);
    if (monthSort !== 0) return monthSort;
    return String(a.event_date || "").localeCompare(String(b.event_date || ""));
  });
  const groupedEvents = groupBy(sortedEvents, (event) => event.month_group || "Unscheduled");
  const upcomingCount = events.filter((event) => !event.is_completed).length;
  const completedCount = events.length - upcomingCount;

  return (
    <Card className="overflow-hidden border-amber-100 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-amber-50 via-white to-orange-50 px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600 text-white shadow-sm">
              <CalendarHeart className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-xl">Calendar of Worship</CardTitle>
              <p className="mt-0.5 text-sm text-gray-600">Plan worship services, Bible studies, and church observances.</p>
            </div>
          </div>
          <Button onClick={onAddNew} className="bg-amber-600 hover:bg-amber-700">
            <Plus className="mr-2 h-4 w-4" />
            Add Worship Event
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Total</p>
            <p className="text-2xl font-bold text-gray-950">{events.length}</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Upcoming</p>
            <p className="text-2xl font-bold text-gray-950">{upcomingCount}</p>
          </div>
          <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-green-700">Completed</p>
            <p className="text-2xl font-bold text-gray-950">{completedCount}</p>
          </div>
        </div>
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-4 py-10 text-center">
            <CalendarHeart className="mx-auto mb-3 h-10 w-10 text-amber-500" />
            <p className="font-semibold text-gray-900">No worship events yet.</p>
            <p className="mt-1 text-sm text-gray-600">Add Sunday services, Bible studies, special observances, and worship calendar notes.</p>
          </div>
        ) : (
          Object.entries(groupedEvents).map(([month, monthEvents]) => (
            <section key={month} className="space-y-3">
              <div className="flex items-center gap-2 border-b border-amber-100 pb-2">
                <h3 className="text-lg font-bold text-gray-950">{month}</h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{monthEvents.length}</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {monthEvents.map((event, index) => {
                  const timeLabel = formatTimeRange(event.event_time, event.end_time);
                  return (
                    <article key={event.id} className={`rounded-lg border bg-white p-4 shadow-sm transition hover:shadow-md ${event.is_completed ? "border-green-200" : "border-amber-200"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">#{index + 1}</span>
                            {event.is_completed ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                                <CheckCircle className="h-3.5 w-3.5" /> Completed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                <Circle className="h-3.5 w-3.5" /> Upcoming
                              </span>
                            )}
                          </div>
                          <h4 className="text-lg font-bold leading-tight text-gray-950">{event.title}</h4>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="sm" onClick={() => onEdit(event)} title="Edit">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => onDuplicate(event)} title="Duplicate">
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => onDelete(event.id)} className="text-red-600 hover:text-red-700" title="Delete">
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm text-gray-600">
                        <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                          <CalendarDays className="h-4 w-4 text-amber-700" />
                          {formatDate(event.event_date)}
                        </span>
                        {timeLabel && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                            <Clock className="h-4 w-4 text-amber-700" />
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      {event.description && (
                        <p className="mt-3 text-sm leading-6 text-gray-600">{event.description}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
