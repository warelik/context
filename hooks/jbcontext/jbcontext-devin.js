#!/usr/bin/env node
// jbcontext — Devin CLI lifecycle hook adapter
//
// Handles SessionStart, PostCompaction, UserPromptSubmit and PreToolUse for Devin CLI.
// Emits upstream jbcontext instructions as additionalContext. No state, no blocks.
//
// Run from a clone of the integration fork. The script resolves its sibling text files
// (session-start.txt, user-prompt-submit.txt, pre-tool-use.txt) relative to its own directory.
// Register it in ~/.config/devin/config.json under the "hooks" key (see scripts/setup-agent-devin.sh).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EVENT = process.argv[2] || 'SessionStart';

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      resolve(input);
    }
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, 500).unref();
  });
}

function readFile(name) {
  try {
    return fs.readFileSync(path.join(__dirname, name), 'utf8').trim();
  } catch (e) {
    return '';
  }
}

function emit(event, context, updatedInput) {
  const out = { hookSpecificOutput: { hookEventName: event } };
  if (context) out.hookSpecificOutput.additionalContext = context;
  if (updatedInput) out.hookSpecificOutput.updatedInput = updatedInput;
  process.stdout.write(JSON.stringify(out));
}

function runIndex() {
  const projectPath = process.env.DEVIN_PROJECT_DIR || process.cwd();
  const child = spawn(
    'jbcontext',
    ['index', '--silent', '--project-path', projectPath],
    { stdio: 'ignore', detached: true }
  );
  child.on('error', () => {});
  child.unref();
}

const DISCOVERY_RE = /(?:^|\s)(?:rg|grep|find)(?:\s|$)/;
const GIT_HISTORY_RE = /(?:^|\s)git\s+(?:log|show|blame)(?:\s|$)/;

function isDiscoveryTool(toolName, toolInput) {
  if (toolName === 'grep' || toolName === 'glob' || toolName === 'find_file_by_name') return true;
  if (toolName === 'exec') {
    const command = String((toolInput || {}).command || '');
    if (DISCOVERY_RE.test(command)) return true;
    if (GIT_HISTORY_RE.test(command)) return true;
  }
  return false;
}

function needsMcpPathFilter(toolName, toolInput) {
  if (toolName !== 'mcp__jbcontext__code_search') return false;
  const input = toolInput || {};
  return !input.pathFilter && !input.path_filter;
}

async function main() {
  if (EVENT === 'SessionStart') {
    emit(EVENT, readFile('session-start.txt'));
    runIndex();
    return;
  }

  if (EVENT === 'PostCompaction') {
    emit(EVENT, readFile('session-start.txt'));
    return;
  }

  if (EVENT === 'UserPromptSubmit') {
    emit(EVENT, readFile('user-prompt-submit.txt'));
    return;
  }

  if (EVENT === 'PreToolUse') {
    const raw = await readStdin();
    let data = {};
    try {
      data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (e) {}

    const toolName = data.tool_name;
    const toolInput = data.tool_input || {};

    // The MCP code_search tool returns empty results when pathFilter is omitted.
    // Inject a project-wide pathFilter for the first/broad call as an upstream workaround.
    if (needsMcpPathFilter(toolName, toolInput)) {
      const updated = { ...toolInput, pathFilter: '.' };
      delete updated.path_filter;
      emit(EVENT, '', updated);
      return;
    }

    if (isDiscoveryTool(toolName, toolInput)) {
      emit(EVENT, readFile('pre-tool-use.txt'));
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const results = [];
  function check(label, fn) {
    try {
      fn();
      results.push({ label, ok: true });
      console.error(`[PASS] ${label}`);
    } catch (e) {
      results.push({ label, ok: false, error: e.message });
      console.error(`[FAIL] ${label}: ${e.message}`);
    }
  }

  const { spawnSync } = require('child_process');
  function invoke(event, input) {
    return spawnSync(process.execPath, [__filename, event], {
      input: input ? JSON.stringify(input) : '',
      encoding: 'utf8',
      timeout: 10000
    });
  }

  check('SessionStart emits full instructions', () => {
    const res = invoke('SessionStart');
    const out = JSON.parse(res.stdout || '{}');
    if (!out.hookSpecificOutput?.additionalContext?.includes('Semantic Code Search')) {
      throw new Error('missing instructions');
    }
  });

  check('PostCompaction emits full instructions', () => {
    const res = invoke('PostCompaction');
    const out = JSON.parse(res.stdout || '{}');
    if (!out.hookSpecificOutput?.additionalContext?.includes('Semantic Code Search')) {
      throw new Error('missing instructions');
    }
  });

  check('UserPromptSubmit emits short reminder', () => {
    const res = invoke('UserPromptSubmit', { prompt: 'find auth' });
    const out = JSON.parse(res.stdout || '{}');
    if (!out.hookSpecificOutput?.additionalContext) throw new Error('missing reminder');
  });

  check('PreToolUse mcp code_search without pathFilter injects pathFilter', () => {
    const res = invoke('PreToolUse', { tool_name: 'mcp__jbcontext__code_search', tool_input: { text: 'auth' } });
    const out = JSON.parse(res.stdout || '{}');
    if (out.hookSpecificOutput?.updatedInput?.pathFilter !== '.') {
      throw new Error(`unexpected output: ${res.stdout}`);
    }
  });

  check('PreToolUse mcp code_search with pathFilter is silent', () => {
    const res = invoke('PreToolUse', { tool_name: 'mcp__jbcontext__code_search', tool_input: { text: 'auth', pathFilter: 'src' } });
    if (res.stdout.trim()) throw new Error(`unexpected output: ${res.stdout}`);
  });

  check('PreToolUse grep emits reminder', () => {
    const res = invoke('PreToolUse', { tool_name: 'grep', tool_input: { pattern: 'auth', path: 'src' } });
    const out = JSON.parse(res.stdout || '{}');
    if (!out.hookSpecificOutput?.additionalContext) throw new Error('missing reminder');
  });

  check('PreToolUse exec rg emits reminder', () => {
    const res = invoke('PreToolUse', { tool_name: 'exec', tool_input: { command: 'rg auth src' } });
    const out = JSON.parse(res.stdout || '{}');
    if (!out.hookSpecificOutput?.additionalContext) throw new Error('missing reminder');
  });

  check('PreToolUse exec ls is silent', () => {
    const res = invoke('PreToolUse', { tool_name: 'exec', tool_input: { command: 'ls -la' } });
    if (res.stdout.trim()) throw new Error(`unexpected output: ${res.stdout}`);
  });

  check('PreToolUse exec git log emits reminder', () => {
    const res = invoke('PreToolUse', { tool_name: 'exec', tool_input: { command: 'git log --oneline src' } });
    const out = JSON.parse(res.stdout || '{}');
    if (!out.hookSpecificOutput?.additionalContext) throw new Error('missing reminder');
  });

  check('PreToolUse read is silent', () => {
    const res = invoke('PreToolUse', { tool_name: 'read', tool_input: { file_path: 'src/main.rs' } });
    if (res.stdout.trim()) throw new Error(`unexpected output: ${res.stdout}`);
  });

  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error(`[SELF-TEST] ${failed.length}/${results.length} failed`);
    process.exit(1);
  }
  console.error(`[SELF-TEST] ${results.length}/${results.length} passed`);
}

if (EVENT === '--self-test') {
  selfTest();
} else {
  main().catch(() => { /* best-effort: never block the session */ });
}
