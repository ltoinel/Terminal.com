/* ------------------------------------------------------------------------- *
 * Shell command-line parsing.
 *
 * Pure, DOM-free splitting of a typed line into a pipeline of stages plus an
 * optional trailing output redirection — the syntax layer behind `|`, `>` and
 * `>>`. Extracted from `terminal.ts` so the parsing rules can be unit-tested
 * without a running shell. Execution (dispatch, capture, file writes) stays in
 * `terminal.ts`.
 * ------------------------------------------------------------------------- */

/** One pipeline stage: a command name and its arguments (tokens after it). */
export interface Stage {
  /** The command name (first token); '' for an empty stage. */
  name: string;
  /** Arguments — the whitespace-separated tokens after the name. */
  args: string[];
  /** The trimmed stage text, as typed. */
  raw: string;
}

/** A trailing output redirection: `> path` (truncate) or `>> path` (append). */
export interface Redirect {
  path: string;
  append: boolean;
}

/** The result of parsing a line: stages, an optional redirect, or an error. */
export interface ParsedLine {
  stages: Stage[];
  redirect: Redirect | null;
  /** A user-facing syntax error (e.g. an empty pipe stage); stages is then empty. */
  error?: string;
}

/** Trailing `>`/`>>` redirection: a non-empty command, the operator, a target. */
const REDIRECT_RE = /^(.*?)\s*(>>?)\s*(\S+)\s*$/;

/** Splits a stage into its command name and argument tokens. */
function tokenize(raw: string): Stage {
  const parts = raw.split(/\s+/).filter(Boolean);
  return { name: parts[0] ?? '', args: parts.slice(1), raw };
}

/**
 * Parses a typed command line into a pipeline of stages plus an optional
 * trailing redirection. Mirrors a minimal shell:
 *  - `a | b | c` becomes three stages; each stage's stdout feeds the next.
 *  - a trailing `> file` / `>> file` is pulled off the *whole* line (the last
 *    redirection wins, as in a shell), and only applies to the final stage.
 *  - an empty stage (`a |`, `| b`, `a || b`) is a syntax error.
 *
 * Pure: it never touches the DOM or filesystem — the caller dispatches stages.
 */
export function parseCommandLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === '') return { stages: [], redirect: null };

  // Pull off a trailing output redirection. A leading `>` (no command before it)
  // is *not* a redirection — it falls through as a normal (unknown) command.
  let redirect: Redirect | null = null;
  let exec = trimmed;
  const m = trimmed.match(REDIRECT_RE);
  if (m && m[1].trim()) {
    exec = m[1];
    redirect = { path: m[3], append: m[2] === '>>' };
  }

  // Split into pipeline stages; an empty one is a syntax error.
  const rawStages = exec.split('|').map((s) => s.trim());
  if (rawStages.some((s) => s === '')) {
    return { stages: [], redirect, error: 'syntax error near `|`' };
  }

  return { stages: rawStages.map(tokenize), redirect };
}
