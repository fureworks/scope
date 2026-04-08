# Scope Works Best When…

Scope reads signals from your existing tools. It doesn't ask you to enter data — it watches what you're already doing. But the quality of its output depends on the quality of those signals.

This isn't about perfecting your workflow. It's about small habits that make Scope (and everything else) work better.

## Git

**Commit frequently.** Scope detects stale uncommitted work. If you go 2 days without committing, it'll flag it. That's usually a real signal — either you're stuck, distracted, or working on something too big. Break it down.

**Use branches.** Scope tracks stale branches and open PRs. Working on `main` with no PRs means Scope has less to work with. A branch per feature gives it (and you) better visibility.

**Keep repos watched.** Only repos in your Scope config get scanned. If you start a new project and forget to add it, Scope can't see it. Run `scope config repos add ~/new-project` when you start something.

## GitHub Issues

**Assign yourself.** Scope only surfaces issues assigned to you (`--assignee @me`). Unassigned issues are invisible — intentionally. If it's your problem, put your name on it.

**Use labels.** Scope scores issues with `urgent`, `critical`, or `bug` labels higher. No labels = lower priority signal. You don't need a complex labeling system — just flag the important ones.

**Close what's done.** Scope flags stale issues (>7 days open). If an issue is resolved but still open, close it. `scope review` tracks what you closed today — it's satisfying.

## Pull Requests

**Request reviews explicitly.** "Review requested" is one of Scope's strongest signals (+8 score). If you need someone to look at a PR, use GitHub's review request feature — don't just mention them in a comment.

**Don't let PRs rot.** Scope escalates PRs that are open >5 days. If a PR is intentionally parked, either close it, convert to draft, or (when `scope snooze` ships) snooze it.

**Keep CI green.** Failing CI adds +5 to the priority score. A red PR that you're ignoring will keep showing up in your NOW list until you fix it or close it.

## Calendar

**Use your actual calendar.** Scope reads today's events and free blocks via Google Calendar. If meetings live in Slack DMs or verbal agreements, Scope can't see them. Put it on the calendar — even a 15-minute block.

**Block focus time.** Scope detects free blocks and suggests what to work on during them. If your calendar is wall-to-wall meetings, Scope can only tell you about the meetings. Blocking 2 hours for "deep work" gives it room to make useful suggestions.

## General

**Run `scope today` in the morning.** It saves a snapshot that `scope review` uses at end of day. No morning run = no carry-over comparison in the evening.

**Treat the ranking as ops radar.** If Scope says something is NOW and you disagree, that's useful information. Either the scoring needs tuning, or you're seeing buildability/context that Scope does not. Scope tells you what needs attention, not what must be built next.

**Use `--json` for downstream tooling.** `scope today --json` exposes why an item surfaced, what lane it belongs to (`review`, `merge`, `nudge`, `investigate`), and whether it looks blocked or already covered by an open PR. That output is the handoff shape for a separate build selector.

**Missing context is okay.** Scope works in degraded mode by design. No calendar? It still reads git. No `gh` CLI? It still shows uncommitted work. Start with what you have. Add integrations as they become useful.

---

*These aren't rules. They're patterns that make signal-based prioritization work better — in Scope or anywhere else.*
