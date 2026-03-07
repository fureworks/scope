import chalk from "chalk";
import { configExists, loadConfig } from "../store/config.js";
import { getCalendarWeek } from "../sources/calendar.js";
import { scanAllRepos } from "../sources/git.js";
import { scanAssignedIssues } from "../sources/issues.js";

interface PlanOptions {
  calendar?: boolean;
  json?: boolean;
}

interface DayView {
  day: string;
  meetings: number;
  freeMinutes: number;
  events: string[];
}

export async function planCommand(options: PlanOptions): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow("  Scope isn't set up yet. Run `scope onboard` to get started.\n")
    );
    process.exit(1);
  }

  const config = loadConfig();
  const gitSignals = await scanAllRepos(config.repos);
  const issueScan = await scanAssignedIssues();

  let calendarWeek: Awaited<ReturnType<typeof getCalendarWeek>> = null;
  if (options.calendar !== false && config.calendar.enabled) {
    calendarWeek = await getCalendarWeek();
  }

  const dayViews = buildDayViews(calendarWeek);
  const bestDays = getBestDays(dayViews);
  const topBuildDays = getTopBuildDays(dayViews, 2);

  const backlog = {
    prsOverWeek: gitSignals.reduce(
      (count, signal) =>
        count + signal.openPRs.filter((pr) => pr.ageDays > 7).length,
      0
    ),
    issuesApproachingStale: issueScan.issues.filter((issue) => issue.ageDays > 14).length,
    reposWithStaleUncommitted: gitSignals.filter(
      (signal) => signal.uncommittedFiles > 0 && signal.lastCommitAge > 72
    ).length,
  };

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          week: dayViews,
          bestDeepWorkDays: bestDays,
          backlog,
          suggestionDays: topBuildDays,
          calendarAvailable: calendarWeek !== null,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("");
  console.log(chalk.bold("  THIS WEEK"));
  console.log(chalk.dim("  ─────────"));

  if (calendarWeek === null) {
    console.log(chalk.dim("  Calendar unavailable for weekly view."));
  } else {
    for (const day of dayViews) {
      const marker = bestDays.includes(day.day) ? " \u2190 best deep work day" : "";
      console.log(
        `  ${day.day}  ${buildBar(day.freeMinutes)} ${day.meetings} meetings, ${formatHours(
          day.freeMinutes
        )} free${marker}`
      );
    }
  }

  console.log("");
  console.log(chalk.bold("  BACKLOG"));
  console.log(chalk.dim("  ───────"));
  console.log(`  ${backlog.prsOverWeek} PRs older than 1 week`);
  console.log(`  ${backlog.issuesApproachingStale} issues approaching stale (>14 days)`);
  console.log(`  ${backlog.reposWithStaleUncommitted} repo with uncommitted work >3 days`);
  console.log("");

  if (topBuildDays.length > 0) {
    console.log(`  💡 ${formatSuggestion(topBuildDays)} are your best build days this week.`);
    console.log("");
  }
}

function buildDayViews(week: Awaited<ReturnType<typeof getCalendarWeek>>): DayView[] {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return order.map((day) => {
    const summary = week?.get(day);
    return {
      day,
      meetings: summary?.meetings ?? 0,
      freeMinutes: summary?.freeMinutes ?? 8 * 60,
      events: summary?.events ?? [],
    };
  });
}

function buildBar(freeMinutes: number): string {
  const workMinutes = 8 * 60;
  const clampedFree = Math.max(0, Math.min(workMinutes, freeMinutes));
  const meetingMinutes = workMinutes - clampedFree;
  const meetingUnits = Math.max(
    0,
    Math.min(6, Math.round((meetingMinutes / workMinutes) * 6))
  );
  return "█".repeat(meetingUnits) + "░".repeat(6 - meetingUnits);
}

function formatHours(freeMinutes: number): string {
  return `${Math.round(freeMinutes / 60)}h`;
}

function getBestDays(days: DayView[]): string[] {
  if (days.length === 0) return [];
  const maxFree = Math.max(...days.map((d) => d.freeMinutes));
  return days.filter((d) => d.freeMinutes === maxFree).map((d) => d.day);
}

function getTopBuildDays(days: DayView[], count: number): string[] {
  return [...days]
    .sort((a, b) => b.freeMinutes - a.freeMinutes)
    .slice(0, count)
    .map((d) => dayToLongName(d.day));
}

function dayToLongName(day: string): string {
  const names: Record<string, string> = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
  };
  return names[day] ?? day;
}

function formatSuggestion(days: string[]): string {
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} + ${days[1]}`;
  return `${days.slice(0, -1).join(", ")} + ${days[days.length - 1]}`;
}
