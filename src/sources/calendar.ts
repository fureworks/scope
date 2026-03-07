export interface CalendarEvent {
  title: string;
  startTime: Date;
  endTime: Date;
  minutesUntilStart: number;
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

    // Get today's events via gws
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const result = execSync(
      `gws calendar events list --timeMin="${startOfDay.toISOString()}" --timeMax="${endOfDay.toISOString()}" --format=json 2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const data = JSON.parse(result);
    const items = (data.items || data || []) as Array<{
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;

    const now = Date.now();

    const events: CalendarEvent[] = items
      .filter((item) => item.start?.dateTime) // skip all-day events
      .map((item) => {
        const startTime = new Date(item.start!.dateTime!);
        const endTime = new Date(item.end!.dateTime!);
        return {
          title: item.summary || "Untitled event",
          startTime,
          endTime,
          minutesUntilStart: Math.round(
            (startTime.getTime() - now) / (1000 * 60)
          ),
        };
      })
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Calculate free blocks (between events, min 30 min)
    const freeBlocks = calculateFreeBlocks(events, today);

    return { events, freeBlocks };
  } catch {
    return null;
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
