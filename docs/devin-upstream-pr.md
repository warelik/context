# Upstream contribution: Devin CLI integration

This document contains the issue and pull-request text that can be submitted to
`https://github.com/JetBrains/context` (or the upstream jbcontext integration
repository) to add first-class Devin CLI support.

## GitHub issue (to file before the PR)

**Title:** Add first-class Devin CLI integration for jbcontext

**Body:**

Devin CLI (`devin`) is a growing terminal-based agent. It supports:

- MCP servers (stdio and HTTP)
- `hooks` (`SessionStart`, `PostCompaction`, `PreToolUse`, `UserPromptSubmit`)
- project-level `.devin/` config and skills
- user-level `~/.config/devin/` config and skills

Currently `jbcontext setup-agent` does not support `--agent=DEVIN`. Users have
to manually wire `jbcontext mcp` and reminders into Devin's JSON hook
pipeline, which is non-trivial because Devin and Claude use different tool
names (`exec` vs `Bash`, `read` vs `Read`, `mcp__jbcontext__code_search` vs a
synthetic `Bash` command, etc.).

### Proposed solution

Add a Devin CLI installer and adapter to the official integration repo:

1. `scripts/setup-agent-devin.sh` — one-command installer for `--scope=USER`
   and `--scope=PROJECT`.
2. `hooks/jbcontext/jbcontext-devin.js` — Node adapter that reads upstream
   instruction text files and emits them as Devin `additionalContext`.
3. `.devin/config.json`, `.devin/hooks.v1.json`, `.devin/skills/` — project
   assets that the installer copies into the user's Devin config.
4. `session-start.txt` — full workflow instructions injected via `SessionStart`
   and `PostCompaction` hooks.
5. `user-prompt-submit.txt` — short reminder injected on every user prompt.
6. `pre-tool-use.txt` — longer reminder injected before local discovery tools.

### Key adapter features

- **REMIND-only hooks**: `SessionStart`, `PostCompaction`, `UserPromptSubmit`,
  and `PreToolUse` inject instructions; no tool is blocked or cancelled.
- **MCP `pathFilter` injection**: the MCP `code_search` tool currently returns
  no results when `pathFilter` is omitted; the adapter injects `pathFilter: "."`
  for broad searches.
- **RTK/ponytail-friendly**: the adapter checks the raw `exec` command for
  `rg`/`grep`/`find`/`git log` after any `rtk`/`ponytail` rewriting, so the
  reminder is shown only for true discovery commands.
- **`/context-explorer` first**: instructions recommend the subagent for broader
  exploration.
- **Background indexing**: `SessionStart` starts `jbcontext index --silent` in
  the background.
- **Self-test**: `node jbcontext-devin.js --self-test` verifies all events.

### Acceptance criteria

- [ ] `./scripts/setup-agent-devin.sh --agent=DEVIN --scope=USER --non-interactive`
      produces a working `~/.config/devin/config.json` with MCP, permissions,
      and four hooks.
- [ ] `./scripts/setup-agent-devin.sh --agent=DEVIN --scope=PROJECT --non-interactive`
      produces a working `.devin/` directory for the current repo.
- [ ] After installation, Devin sees instructions at `SessionStart` and
      reminders at `UserPromptSubmit` and `PreToolUse`, and `mcp__jbcontext__code_search`
      receives `pathFilter` when omitted.
- [ ] `node hooks/jbcontext/jbcontext-devin.js --self-test` passes (10/10).

---

## Pull request title

`feat: add Devin CLI integration`

## Pull request body

```markdown
## Summary

This PR adds a complete Devin CLI integration for jbcontext, mirroring the
existing Claude, Codex, and Junie integrations but taking advantage of Devin's
MCP + hooks architecture.

### What's included

- `hooks/jbcontext/jbcontext-devin.js` — Node adapter that reads upstream
  instruction text files and emits them as `additionalContext` for the four
  lifecycle hooks. It injects `pathFilter: "."` when `mcp__jbcontext__code_search`
  is called without one and starts a background `jbcontext index` on `SessionStart`.
- `hooks/jbcontext/session-start.txt` — full workflow instructions injected at
  `SessionStart` and `PostCompaction`.
- `hooks/jbcontext/user-prompt-submit.txt` — short reminder injected at
  `UserPromptSubmit`.
- `hooks/jbcontext/pre-tool-use.txt` — longer reminder injected before
  `grep`/`glob`/`find_file_by_name`/`exec rg|grep|find|git log`.
- `.devin/config.json` — registers the `jbcontext` MCP server and allows
  `mcp__jbcontext__*` and `Exec(jbcontext)`.
- `.devin/hooks.v1.json` — hook manifest covering `SessionStart`,
  `PostCompaction`, `PreToolUse`, and `UserPromptSubmit`.
- `.devin/skills/` — Devin versions of `context-search`, `context-research`,
  `context-review`, `context-install`, `org-search`, `dependency-search`,
  `blast-radius`, and `context-explorer` (subagent skill with `subagent: true`).
- `scripts/setup-agent-devin.sh` — one-command installer for user and project
  scope. Resolves the `jbcontext` binary to an absolute path for the MCP server,
  installs hooks/skills/MCP descriptions, and optionally writes `AGENTS.md`
  (`--instructions`).
- `config-examples/devin-config.json` and `config-examples/devin-hooks.v1.json`
  — standalone reference copies.
- `README.md` — updated with the Devin integration section.
- `docs/devin-upstream-pr.md` — issue/PR text for upstream tracking.

### Why a Node adapter is needed

Devin's `PreToolUse` payload uses `tool_name` values such as `exec`, `read`,
`grep`, `glob`, `find_file_by_name`, `mcp__jbcontext__code_search`. The adapter
identifies local discovery commands, unwraps `rtk` prefixes, and emits the right
reminder text. It also injects `pathFilter` for the MCP tool as a workaround
until the server accepts an omitted filter.

### Test plan

1. Install jbcontext CLI and run `jbcontext index` in a project.
2. Run `./scripts/setup-agent-devin.sh --agent=DEVIN --scope=USER --non-interactive`.
3. Launch `devin` in the project and ask a broad code-discovery question.
4. Verify Devin calls `mcp__jbcontext__code_search` (or `/context-search`)
   before `grep`/`rg`/`find`/`find_file_by_name`.
5. Run `node hooks/jbcontext/jbcontext-devin.js --self-test` — 10/10 pass.

### Notes

- The `mcp__jbcontext__code_search` tool currently returns empty results when
  `pathFilter` is omitted; the adapter injects `pathFilter: "."` for broad
  searches. Once the server handles an omitted `pathFilter` correctly, this
  injection can be removed.
- `mcp/*.txt` contain suggested tool/parameter descriptions that Devin (and
  most MCP clients) currently read from the server's `tools/list` response.
  They are included for documentation and can be wired into `jbcontext mcp`
  once custom descriptions are supported.
```

## Files changed vs upstream

After the contribution is accepted, the upstream repository should contain:

```
.devin/
  config.json
  hooks.v1.json
  skills/
    blast-radius/SKILL.md
    context-explorer/SKILL.md
    context-install/SKILL.md
    context-research/SKILL.md
    context-review/SKILL.md
    context-search/SKILL.md
    dependency-search/SKILL.md
    org-search/SKILL.md
hooks/
  jbcontext/
    jbcontext-devin.js
    pre-tool-use.txt
    session-start.txt
    user-prompt-submit.txt
scripts/
  setup-agent-devin.sh
config-examples/
  devin-config.json
  devin-hooks.v1.json
README.md
docs/
  devin-upstream-pr.md
```

## Fork vs upstream

Until the PR is merged, the fork at `<your-fork>/context` (or equivalent) can be
used directly:

```bash
git clone <your-fork-url>
cd context
./scripts/setup-agent-devin.sh --agent=DEVIN --scope=USER --non-interactive
```

This gives any user a complete, clockwork Devin CLI integration from a single
command.
