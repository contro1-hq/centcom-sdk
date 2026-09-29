import type { CentcomClient } from "./client.js";
import type { AuditRecord, ToolCall } from "./types.js";

/**
 * Report what an agent did, from the code around it rather than from the model.
 *
 * A model told to "always report" can skip it or describe something else, so
 * the reporting belongs in the runtime: a wrapper that runs around every tool
 * call, which the model cannot see and cannot skip.
 *
 *   const run = new TraceRun(client, { source: "mastra", failClosed: true });
 *   const lookupOrder = run.wrap("lookup_order", rawLookupOrder);
 *   const researcher = run.subAgent("researcher");     // a named part, same trace tree
 *
 * `failClosed: true` means a tool whose start could not be recorded does not
 * run: the wrapper throws TraceReportError. Without it, a failed report is
 * dropped and the tool runs, so an outage of the trace is not an outage of the
 * agent. Fail closed for anything that changes something; open for reads.
 */

const OUTPUT_LIMIT = 2000;

export class TraceReportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TraceReportError";
  }
}

export function newTraceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `trc_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function summary(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length <= OUTPUT_LIMIT ? text : `${text.slice(0, OUTPUT_LIMIT - 15)}...[truncated]`;
}

function plainInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export interface TraceRunOptions {
  traceId?: string;
  parentTraceId?: string;
  source?: string;
  runId?: string;
  failClosed?: boolean;
}

/** One run of one agent, reported step by step under one trace id. */
export class TraceRun {
  readonly traceId: string;
  readonly parentTraceId?: string;
  readonly source: string;
  readonly runId?: string;
  readonly failClosed: boolean;

  constructor(readonly client: CentcomClient, options: TraceRunOptions = {}) {
    this.traceId = options.traceId ?? newTraceId();
    this.parentTraceId = options.parentTraceId;
    this.source = options.source ?? "custom";
    this.runId = options.runId;
    this.failClosed = options.failClosed ?? false;
  }

  /** A named part of this agent, as a child run linked by parent_trace_id. */
  subAgent(name: string, options: { failClosed?: boolean } = {}): TraceRun {
    return new TraceRun(this.client.asSubAgent(name), {
      parentTraceId: this.traceId,
      source: this.source,
      runId: this.runId,
      failClosed: options.failClosed ?? this.failClosed,
    });
  }

  /** Record one step. Resolves to the record, or undefined when a non-strict report failed. */
  async report(
    action: string,
    text: string,
    options: { toolCalls?: ToolCall[]; outcome?: "success" | "failure" | "partial"; severity?: "info" | "notice" | "warning"; metadata?: Record<string, unknown>; failClosed?: boolean } = {},
  ): Promise<AuditRecord | undefined> {
    try {
      return await this.client.logAction({
        action: action.slice(0, 128),
        summary: text.slice(0, 2000),
        source: { integration: this.source, ...(this.runId ? { run_id: this.runId } : {}) },
        outcome: options.outcome ?? "success",
        severity: options.severity ?? "info",
        trace_id: this.traceId,
        ...(this.parentTraceId ? { parent_trace_id: this.parentTraceId } : {}),
        ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
      });
    } catch (error) {
      if (options.failClosed ?? this.failClosed) {
        throw new TraceReportError(`Contro1 did not record '${action}': ${(error as Error)?.message ?? error}`, error);
      }
      return undefined;
    }
  }

  /** Record that a tool is about to run. Throws when failing closed and it could not. */
  async toolStarted(name: string, input?: unknown): Promise<number> {
    const call: ToolCall = { name: name.slice(0, 200), started_at: new Date().toISOString() };
    const plain = plainInput(input);
    if (plain) call.input = plain;
    await this.report(`tool.${name}.started`, `Calling ${name}`, { toolCalls: [call] });
    return Date.now();
  }

  /** Record how a tool ended. Never throws: the tool has already run. */
  async toolFinished(name: string, result: { output?: unknown; error?: unknown; started?: number } = {}): Promise<void> {
    const failed = result.error !== undefined;
    const call: ToolCall = {
      name: name.slice(0, 200),
      outcome: failed ? "failure" : "success",
      ended_at: new Date().toISOString(),
      ...(result.started ? { started_at: new Date(result.started).toISOString() } : {}),
      ...(failed ? { error: summary((result.error as Error)?.message ?? result.error) } : {}),
      ...(!failed && result.output !== undefined ? { output_summary: summary(result.output) } : {}),
    };
    await this.report(`tool.${name}.${failed ? "failed" : "finished"}`, `${name} ${failed ? "failed" : "returned"}`, {
      toolCalls: [call],
      outcome: failed ? "failure" : "success",
      severity: failed ? "warning" : "info",
      failClosed: false,
    });
  }

  /** Report every call of `fn`: its start (strictly, if failing closed) and its end. */
  wrap<A extends unknown[], R>(name: string, fn: (...args: A) => R | Promise<R>): (...args: A) => Promise<R> {
    return async (...args: A): Promise<R> => {
      const started = await this.toolStarted(name, args.length === 1 ? args[0] : { args });
      try {
        const output = await fn(...args);
        await this.toolFinished(name, { output, started });
        return output;
      } catch (error) {
        await this.toolFinished(name, { error, started });
        throw error;
      }
    };
  }
}
