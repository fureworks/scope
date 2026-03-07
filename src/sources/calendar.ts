export interface CalendarEvent {
  title: string;
  startTime: Date;
  endTime: Date;
  minutesUntilStart: number;
}

export interface CalendarDaySummary {
  meetings: number;
  freeMinutes: number;
  events: string[];
}

export interface CalendarSignal {
  events: CalendarEvent[];
  freeBlocks: FreeBlock[];
}

export interface FreeBlock {
  start: Date;
  end: Date;
  durationMinutes: number;
}

export async function getCalendarToday(): Promise<CalendarSignal | null> {
  try {
    const { execSync } = await import("node:child_process");

    // Check if gws is installed
    try {
      execSync("which gws", { stdio: "pipe" });
    } catch {
      return null;
    }

    // Get today's events via gws calendar +agenda --today
    const result = execSync(
      `gws calendar +agenda --today --format json 2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let items: Array<{
      summary?: string;
      title?: string;
      start?: string | { dateTime?: string; date?: string };
      end?: string | { dateTime?: string; date?: string };
      startTime?: string;
      endTime?: string;
    }>;

    try {
      const data = JSON.parse(result);
      // gws may return array directly or nested in a field
      items = Array.isArray(data) ? data : data.items || data.events || [];
    } catch {
      // Try parsing as NDJSON (one JSON object per line)
      items = result
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line);
            // Could be a wrapper with items array or a single event
            if (Array.isArray(parsed)) return parsed;
            if (parsed.items) return parsed.items;
            if (parsed.events) return parsed.events;
            return [parsed];
          } catch {
            return [];
          }
        });
    }

    const now = Date.now();

    const events: CalendarEvent[] = items
      .map((item) => {
        // Handle various gws output formats
        const startStr =
          typeof item.start === "string"
            ? item.start
            : item.start?.dateTime || item.startTime;
        const endStr =
          typeof item.end === "string"
            ? item.end
            : item.end?.dateTime || item.endTime;
        const title = item.summary || item.title || "Untitled event";

        if (!startStr) return null;

        const startTime = new Date(startStr);
        const endTime = endStr ? new Date(endStr) : new Date(startTime.getTime() + 60 * 60 * 1000);

        if (isNaN(startTime.getTime())) return null;

        return {
          title,
          startTime,
          endTime,
          minutesUntilStart: Math.round(
            (startTime.getTime() - now) / (1000 * 60)
          ),
        };
      })
      .filter((e): e is CalendarEvent => e !== null)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Calculate free blocks (between events, min 30 min)
    const freeBlocks = calculateFreeBlocks(events, new Date());

    return { events, freeBlocks };
  } catch {
    return null;
  }
}

export async function getCalendarWeek(): Promise<Map<string, CalendarDaySummary> | null> {
  try {
    const { execSync } = await import("node:child_process");

    try {
      execSync("which gws", { stdio: "pipe" });
    } catch {
      return null;
    }

    const { monday, friday } = getCurrentWorkWeekRange();
    const result = execSync(
      `gws calendar +agenda --from ${formatDate(monday)} --to ${formatDate(friday)} --format json 2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const items = parseCalendarItems(result);
    const summaries = initializeWeekSummaries(monday);

    for (const item of items) {
      const startStr =
        typeof item.start === "string"
          ? item.start
          : item.start?.dateTime || item.start?.date || item.startTime;
      const endStr =
        typeof item.end === "string"
          ? item.end
          : item.end?.dateTime || item.end?.date || item.endTime;
      const title = item.summary || item.title || "Untitled event";
      if (!startStr) continue;

      const startTime = new Date(startStr);
      if (isNaN(startTime.getTime())) continue;
      const endTime = endStr
        ? new Date(endStr)
        : new Date(startTime.getTime() + 60 * 60 * 1000);
      if (isNaN(endTime.getTime())) continue;

      const dayName = getDayKey(startTime);
      const summary = summaries.get(dayName);
      if (!summary) continue;

      summary.meetings += 1;
      summary.events.push(title);

      const meetingMinutes = Math.max(
        0,
        Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60))
      );
      summary.freeMinutes = Math.max(0, summary.freeMinutes - meetingMinutes);
    }

    return summaries;
  } catch {
    return null;
  }
}

function initializeWeekSummaries(monday: Date): Map<string, CalendarDaySummary> {
  const map = new Map<string, CalendarDaySummary>();

  for (let i = 0; i < 5; i += 1) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    map.set(getDayKey(day), {
      meetings: 0,
      freeMinutes: 8 * 60,
      events: [],
    });
  }

  return map;
}

function getCurrentWorkWeekRange(): { monday: Date; friday: Date } {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);

  const day = monday.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diffToMonday);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return { monday, friday };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDayKey(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function parseCalendarItems(raw: string): Array<{
  summary?: string;
  title?: string;
  start?: string | { dateTime?: string; date?: string };
  end?: string | { dateTime?: string; date?: string };
  startTime?: string;
  endTime?: string;
}> {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.events)) return data.events;
    return [];
  } catch {
    return raw
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          if (Array.isArray(parsed)) return parsed;
          if (Array.isArray(parsed.items)) return parsed.items;
          if (Array.isArray(parsed.events)) return parsed.events;
          return [parsed];
        } catch {
          return [];
        }
      });
  }
}

function calculateFreeBlocks(
  events: CalendarEvent[],
  today: Date
): FreeBlock[] {
  const blocks: FreeBlock[] = [];
  const now = new Date();

  // Working hours: 9am to 6pm
  const workStart = new Date(today);
  workStart.setHours(9, 0, 0, 0);
  const workEnd = new Date(today);
  workEnd.setHours(18, 0, 0, 0);

  // Start from now or work start, whichever is later
  let cursor = new Date(Math.max(now.getTime(), workStart.getTime()));

  const futureEvents = events.filter(
    (e) => e.endTime.getTime() > cursor.getTime()
  );

  for (const event of futureEvents) {
    if (event.startTime.getTime() > cursor.getTime()) {
      const gapMinutes = Math.round(
        (event.startTime.getTime() - cursor.getTime()) / (1000 * 60)
      );
      if (gapMinutes >= 30) {
        blocks.push({
          start: new Date(cursor),
          end: new Date(event.startTime),
          durationMinutes: gapMinutes,
        });
      }
    }
    // Move cursor past this event
    if (event.endTime.getTime() > cursor.getTime()) {
      cursor = new Date(event.endTime);
    }
  }

  // Check for free time after last event until end of work
  if (cursor.getTime() < workEnd.getTime()) {
    const gapMinutes = Math.round(
      (workEnd.getTime() - cursor.getTime()) / (1000 * 60)
    );
    if (gapMinutes >= 30) {
      blocks.push({
        start: new Date(cursor),
        end: new Date(workEnd),
        durationMinutes: gapMinutes,
      });
    }
  }

  return blocks;
}
