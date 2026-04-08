# Scope

**Scope tells you the 3 things that matter right now — and gives you permission to ignore everything else.**

A personal ops CLI for builders who juggle multiple repos, PRs, meetings, and issues. Scope reads your existing workflow signals and surfaces what needs attention. No manual input. No new accounts. No cloud.

## Install

```bash
npm install -g @fureworks/scope
```

Requires Node.js 18+.

## Quick Start

```bash
scope onboard    # guided first-time setup
scope today      # what matters right now
scope review     # end-of-day summary
```

Or set up non-interactively (great for AI agents):

```bash
scope init
scope config repos add ~/projects/my-app ~/projects/api
scope config repos scan ~/work     # auto-discover git repos
scope config calendar enable
scope config projects add myproject --dir ~/projects/my-app
```

## What It Does

Scope reads signals from tools you already use:

- **Git** — uncommitted work, stale branches, recent activity
- **GitHub** — open PRs, review requests, CI status, assigned issues
- **Google Calendar** — meetings, free blocks (via `gws` CLI)

Then it scores and ranks everything using deterministic rules (no AI):

```
$ scope today

  Good morning. Here's what matters:

  NOW
  ───
  🔴 PR #8 on api-service (low context: no CI status)
     auth migration — review requested, 3 days old
     Why: Someone's waiting on your review. 3 days stale.

  TODAY
  ────
  🟡 fureworks/scope
     3 uncommitted files, last touched 6h ago
     Why: Uncommitted work for 6 hours. Commit or stash.

  IGNORED
  ───────
  ✗ PR #2 on docs — Fresh, no one's waiting
  ✗ Issue #12 on scope — Less than a week old, no priority label

  Nothing else needs you today.
```

Important: `scope today` is an ops radar, not a build queue. It tells you what needs attention. A downstream agent can decide what is actually buildable.

## Commands

| Command | What it does |
|---------|-------------|
| `scope today` | Morning priorities — what needs attention right now |
| `scope review` | End-of-day summary — what got done, what's carrying over |
| `scope plan` | Weekly view — calendar density, PR backlog, best build days |
| `scope status` | Overview of all watched projects |
| `scope switch <project>` | Context switch between projects |
| `scope context` | Show current project state |
| `scope snooze <item> --until <date>` | Hide an item until a date |
| `scope mute <item>` | Permanently hide an item |
| `scope tune [key] [value]` | Adjust scoring weights |
| `scope config repos\|calendar\|projects` | Manage configuration |
| `scope init` | Initialize Scope |
| `scope onboard` | Interactive guided setup |
| `scope daemon start\|stop\|status` | Background signal checks |
| `scope notifications` | View recent alerts |

## How Scoring Works

Each item gets a priority score based on measurable signals:

```
Score = (Time Pressure + Staleness + Blocking Potential + Effort Match) × Weight
```

- **Score ≥ 8** → 🔴 **NOW** — do these first (max 3 shown)
- **Score 4–7** → 🟡 **TODAY** — fit these in (max 5 shown)
- **Score < 4** → **IGNORED** — shown with reason, explicitly excluded

Adjust weights with `scope tune`:

```bash
scope tune staleness 1.5   # stale items rank higher
scope tune blocking 0.5    # reduce blocking urgency
scope tune --reset          # restore defaults
```

## Time Awareness

`scope today` adjusts its tone based on when you run it:

- **Morning:** "Good morning. Here's what matters."
- **Afternoon:** "3/5 from this morning done. 2 remaining."
- **Evening:** "Run `scope review` to wrap up."

## Weekly Planning

```
$ scope plan

  THIS WEEK
  ─────────
  Mon  ████░░ 3 meetings, 2h free
  Tue  ██░░░░ 1 meeting, 5h free ← best deep work day
  Wed  █████░ 4 meetings, 1h free
  Thu  ███░░░ 2 meetings, 4h free
  Fri  █░░░░░ 0 meetings, 7h free

  BACKLOG
  ───────
  3 PRs older than 1 week
  2 issues approaching stale (>14 days)

  💡 Tuesday + Friday are your best build days this week.
```

## Prerequisites

Scope reads from external tools. All are optional — missing integrations reduce output but never crash.

| Tool | What it provides | Install |
|------|-----------------|---------|
| `gh` (GitHub CLI) | PRs, issues, CI status | [cli.github.com](https://cli.github.com/) |
| `gws` (Google Workspace CLI) | Calendar events, free blocks | `npm i -g @googleworkspace/cli` |

## Best Practices

See [WORKFLOW.md](./WORKFLOW.md) for habits that make Scope's output better — commit often, assign yourself, use labels, block focus time.

## Machine-readable ops-radar output

`scope today --json` returns a stable advisory shape for downstream tools. Each surfaced item includes fields such as:

- `score`
- `scoreBreakdown`
- `whySurfaced`
- `repoMomentum`
- `coveredByOpenPr`
- `blocked`
- `blockedReason`
- `freshnessCheckedAt`
- `attentionLane`

Example:

```json
{
  "mode": "ops-radar",
  "advisory": true,
  "generatedAt": "2026-04-08T04:00:00.000Z",
  "now": [
    {
      "label": "PR #18 on scope",
      "score": 27,
      "whySurfaced": ["review requested", "open 6 days"],
      "attentionLane": "review",
      "coveredByOpenPr": false,
      "blocked": false
    }
  ]
}
```

Use this as awareness input, not as proof that something should be built next.

## Philosophy

- **Zero manual input.** Scope reads. It doesn't ask you to enter data.
- **Confident exclusion.** The value isn't what's shown — it's what's hidden and why.
- **Advisory, not authoritative.** Scope is the ops radar. It should not pretend to be the nightly build selector.
- **Degraded mode is fine.** Only have git? Scope works. Add calendar? Better. Each integration is additive.
- **CLI-first, local-first.** No accounts, no cloud, no tracking.
- **No AI (v1).** Deterministic rules-based scoring. Transparent and predictable.

## Data

Everything lives in `~/.scope/`:

```
~/.scope/
├── config.toml          # configuration
├── contexts/            # saved project contexts
├── snapshots/           # daily snapshots (for review comparison)
├── muted.json           # snoozed/muted items
├── notifications.log    # notification history
└── daemon.pid           # background process
```

## License

MIT — [Fureworks](https://fureworks.com)
