# jbcontext Instructions

A collection of skills, agents, and instructions that integrate jbcontext into agents through hooks, MCP and Agents.md.

### Skills


| Skill | Description |
|---|---|
| `context-search` | `/context-search` — run a semantic code search |
| `context-research` | `/context-research` — deep codebase exploration using `jbcontext search` and `jbcontext history` |
| `context-install` | `/context-install` — install the jbcontext CLI |
| `org-search` | `/org-search` — experimental org-wide semantic search |
| `dependency-search` | `/dependency-search` — org-wide dependency usage and upgrade research |
| `blast-radius` | `/blast-radius` — org-wide impact and consumer analysis |

### Agents

Read-only exploration subagents that run several `jbcontext search` queries in their own context and return `file:line` references with code snippets — useful for more extensive exploration without cluttering the main thread.

| Agent | Description |
|---|---|
| `context-explorer` (Claude) | `agents/claude/context-explorer.md` — Claude subagent, invoked via `Task(subagent_type='context-explorer', ...)`. |
| `context_explorer` (Codex) | `agents/codex/context-explorer.toml` — Codex custom agent (install under `~/.codex/agents/` or `.codex/agents/`). Codex spawns subagents only when asked, so request it directly, e.g. "use `context_explorer` to map the auth flow". |

### Devin CLI integration

The `scripts/setup-agent-devin.sh` installer registers `jbcontext` as an MCP server and installs lifecycle hooks that inject reminders at `SessionStart`, `PostCompaction`, `UserPromptSubmit` and `PreToolUse`.

```bash
./scripts/setup-agent-devin.sh --agent=DEVIN --scope=USER --non-interactive
```

- `SessionStart` / `PostCompaction` inject the full `session-start.txt` instructions and start a background `jbcontext index`.
- `UserPromptSubmit` injects a short reminder from `user-prompt-submit.txt`.
- `PreToolUse` injects a longer reminder from `pre-tool-use.txt` only when a local discovery tool (`grep`, `glob`, `find_file_by_name`, `exec` with `rg`/`grep`/`find`/`git log`) is about to run. It also injects `pathFilter: "."` when `mcp__jbcontext__code_search` is called without one.

No tool is blocked or rewritten; reminders are purely informational.
