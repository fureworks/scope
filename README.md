# Scope

**Personal ops CLI — focus on what matters.**

Scope reads your existing workflow (git repos, calendar, PRs) and tells you what actually needs your attention. It doesn't add to your workflow — it gives you clarity.

## Why

AI tools made you more capable. Which means more gets piled on. The bottleneck moved from *execution* to *prioritization and context switching*.

Scope sits above your tools and helps you focus.

## Install

```bash
npm install -g @fureworks/scope
```

## Quick Start

```bash
scope onboard     # Guided setup (1 minute)
scope today       # What matters right now
```

## Commands

```
scope onboard              Guided first-time setup
scope today                What needs your attention right now
scope status               Overview of all watched projects
scope switch <project>     Switch to a project context
scope context              Show current project context
scope review               End-of-day summary
scope config               View/edit configuration
```

## How It Works

Scope reads signals from your existing tools:

- **Git** — uncommitted changes, stale branches, open PRs
- **Google Calendar** — today's meetings, free blocks (via [gws](https://github.com/googleworkspace/cli))
- **GitHub** — PR reviews waiting on you, failing CI

It scores each item by urgency, staleness, and blocking potential, then shows you what matters:

```
$ scope today

  NOW
  ───
  🔴 Meeting: Team standup in 45 min
  🔴 PR #8 on api-service — waiting on your review (3 days)

  TODAY
  ────
  🟡 fureworks/scope — 3 uncommitted files, last touched 2h ago
  🟡 PR #12 on fureworks.com — open 3 days, no review

  💡 2h free block after standup (14:00–16:00)
     Good for: fureworks/scope (has pending work)

  4 other items can wait → scope status
```

## Design Principles

- **CLI-first, local-first** — your data stays on your machine
- **Reads, doesn't create** — no new inputs required from you
- **Opinionated output** — tells you what matters, not just lists stuff
- **Degrades gracefully** — missing integrations skip quietly, never crash
- **Open source** — MIT licensed

## Prerequisites

- Node.js 18+
- Git
- [GitHub CLI](https://cli.github.com/) (`gh`) — for PR data
- [Google Workspace CLI](https://github.com/googleworkspace/cli) (`gws`) — for calendar (optional)

## Status

🚧 **v0.1 in development** — early but usable.

## License

MIT — see [LICENSE](./LICENSE)

---

*A [Fureworks](https://fureworks.com) project — works born from human touch.*
