/**
 * Action Gateway client.
 *
 * The rest of this SDK asks a human a question and reads the answer. This part
 * makes Contro1 DO something with a customer's credential, so three of its
 * design choices are deliberately less convenient than they could be.
 *
 * 1. AN IDEMPOTENCY KEY IS REQUIRED FOR ANYTHING SIDE-EFFECTING, and the SDK
 *    will not invent one. A key derived from the payload would collapse two
 *    legitimate identical reminders an hour apart into one send. Only the
 *    caller knows whether two identical requests are one intent or two.
 *
 * 2. WAITING IS NOT RETRYING. `waitForInvocation` polls a state; it never
 *    re-submits. An SDK that retried a send on a network blip would send twice,
 *    and the caller would have no way to know.
 *
 * 3. `execution_indeterminate` IS RETURNED, NOT THROWN AS A FAILURE. It means
 *    the provider call may or may not have taken effect. Treating it as an
 *    error invites a retry, which is exactly the wrong move; it is a state a
 *    person has to resolve.
 */

import type { CentcomClient } from "./client.js";

export type ActionInvocationState =
  | "received"
  | "validated"
  | "user_auth_required"
  | "awaiting_approval"
  | "ready"
  | "executing"
  | "executed"
  | "execution_failed"
  | "execution_indeterminate"
  | "denied"
  | "expired"
  | "cancelled"
  | "binding_mismatch";

/** States nothing moves on without a person or a new request. */
export const ACTION_TERMINAL_STATES: readonly ActionInvocationState[] = [
  "executed",
  "execution_failed",
  "execution_indeterminate",
  "denied",
  "expired",
  "cancelled",
  "binding_mismatch",
];

export type AuthorityMode = "agent_principal" | "user_delegated";
export type ActionAccountMode = "personal" | "shared" | "organization";

export interface InvokeActionParams {
  action_id: string;
  action_version?: number;
  input: Record<string, unknown>;
  /**
   * `agent_principal`: the agent acts as itself, with no acting user.
   * `user_delegated`: the call is made for the person named in
   * `acting_user_id`. Accepted from that person's own credential, or from an
   * agent the person delegated this Action to (`whoami` lists them under
   * `acts_for`). A personal account always needs this.
   */
  authority_mode: AuthorityMode;
  account_mode: ActionAccountMode;
  connection_id?: string;
  acting_user_id?: string;
  target_resource?: { kind: string; id: string };
  trace_id?: string;
  parent_trace_id?: string;
  thread_id?: string;
  /** Must be https, with no credentials, fragment or literal IP host. */
  callback_url?: string;
  /**
   * REQUIRED for a side-effecting Action. Not generated here on purpose: a key
   * derived from the payload would merge two legitimate identical sends.
   */
  idempotency_key?: string;
}

export interface ActionInvocation {
  invocation_id: string;
  action_id: string;
  action_version: number;
  application_connector: string;
  connection_id?: string;
  state: ActionInvocationState;
  /** Always `gateway_verified` on an invocation: Contro1 made the call. */
  evidence_provenance: "gateway_verified";
  input_summary?: Record<string, unknown>;
  result_summary?: Record<string, unknown>;
  approval_request_id?: string;
  error?: { code: string; message: string };
  attempts: Array<{
    attempt: number;
    started_at?: string;
    finished_at?: string;
    outcome?: string;
    provider_ref?: string;
    error_code?: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface InvokeActionResult {
  ok: true;
  /** True when an existing invocation was returned for a repeated key. */
  reused: boolean;
  invocation: ActionInvocation;
  /** What the Action produced, when it ran inline during this call. */
  result?: unknown;
  /** Why there is no result yet, for example that it is awaiting approval. */
  result_unavailable?: string;
  /** Accepted and recorded, but the inline attempt did not run. Read it again later. */
  not_run?: { code: string; message: string };
}

/**
 * The invocation has no result to read, and `reason` says why.
 *
 * Not a failure of the Action: an expired or unreadable result belongs to an
 * Action that ran and succeeded. Do not resubmit to get it back.
 */
export class ActionResultUnavailableError extends Error {
  constructor(readonly invocationId: string, readonly reason: string) {
    super(`No result for invocation ${invocationId}: ${reason}`);
    this.name = "ActionResultUnavailableError";
  }
}


/**
 * A delegation: a short-lived token letting a CHILD agent act on a narrowed
 * slice of this agent's authority.
 *
 * `max_risk_level` is required rather than defaulted. A delegation that
 * silently inherited its parent's ceiling would be the widest one available,
 * chosen by omission - and the caller would not have decided anything.
 */
export interface DelegateParams {
  /** The agent receiving the authority. Cannot be the caller. */
  child_agent_id: string;
  /**
   * Actions the child may run. Never wider than the caller's own; `'*'` is
   * refused rather than interpreted.
   */
  allowed_action_ids?: string[];
  allowed_connection_ids?: string[];
  max_risk_level: "low" | "medium" | "high" | "critical";
  /** At most 300. Defaults to the maximum, which is still five minutes. */
  ttl_seconds?: number;
  trace_id?: string;
}

export interface DelegationResult {
  /**
   * SHOWN ONCE. Nothing stores it and no endpoint can read it back. Hand it to
   * the child process and let it expire; do not write it to disk.
   */
  token: string;
  expires_at: string;
  delegation_depth: number;
  max_delegation_depth: number;
}

export class ActionsApi {
  constructor(private readonly client: CentcomClient) {}

  /**
   * Submit an Action. Returns as soon as the Gateway has accepted it, which may
   * be before anything has been executed - an Action needing approval sits in
   * `awaiting_approval` until a human decides.
   */
  async invoke(params: InvokeActionParams): Promise<InvokeActionResult> {
    const { idempotency_key, ...body } = params;
    const headers: Record<string, string> = {};
    if (idempotency_key) headers["Idempotency-Key"] = idempotency_key;
    return this.client.post<InvokeActionResult>("/actions/invoke", body, headers);
  }

  /**
   * Mint a delegation token for a child agent.
   *
   * The parent is whoever this client is authenticated AS - the id in the path
   * is checked against the credential, not trusted from it. The Gateway
   * resolves the caller's current authority at this moment and refuses anything
   * wider, so authority removed a minute ago cannot be delegated now.
   */
  async delegate(agentId: string, params: DelegateParams): Promise<DelegationResult> {
    return this.client.post<DelegationResult>(
      `/agents/${encodeURIComponent(agentId)}/delegations`,
      params,
    );
  }

  async get(invocationId: string): Promise<ActionInvocation> {
    const response = await this.client.get<{ ok: true; invocation: ActionInvocation }>(
      `/actions/${encodeURIComponent(invocationId)}`,
    );
    return response.invocation;
  }

  /**
   * What the Action produced, for example the messages a list returned.
   *
   * Only for the agent this client is authenticated as, and only once the
   * invocation is `executed`. Throws `ActionResultUnavailableError` with the
   * server's reason otherwise: "not run yet", "expired" and "cannot be read"
   * each lead somewhere different, and none is a reason to run it again.
   */
  async getResult<T = unknown>(invocationId: string): Promise<T> {
    const response = await this.client.get<{ ok: true; result?: T; result_unavailable?: string }>(
      `/actions/${encodeURIComponent(invocationId)}`,
    );
    if ("result" in response) return response.result as T;
    throw new ActionResultUnavailableError(
      invocationId,
      response.result_unavailable ?? "No result was returned for this invocation.",
    );
  }

  async cancel(invocationId: string): Promise<ActionInvocation> {
    const response = await this.client.post<{ ok: true; invocation: ActionInvocation }>(
      `/actions/${encodeURIComponent(invocationId)}/cancel`,
    );
    return response.invocation;
  }

  /**
   * Poll until the invocation reaches a terminal state.
   *
   * POLLS. It re-reads state and never re-submits, because a resubmission on a
   * network blip would send a second email that the caller has no way to learn
   * about. If the read itself fails, that error propagates rather than being
   * swallowed and retried into an unbounded wait.
   *
   * Returns `execution_indeterminate` rather than throwing on it: that state
   * means the call may or may not have taken effect, and turning it into an
   * exception invites the retry that must not happen.
   */
  async waitForInvocation(
    invocationId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<ActionInvocation> {
    const intervalMs = options.intervalMs ?? 3_000;
    const deadline = Date.now() + (options.timeoutMs ?? 600_000);

    for (;;) {
      const invocation = await this.get(invocationId);
      if ((ACTION_TERMINAL_STATES as readonly string[]).includes(invocation.state)) {
        return invocation;
      }
      if (Date.now() >= deadline) {
        // The invocation is still live on the server. Say so, and name it, so
        // the caller polls again rather than assuming nothing happened.
        throw new Error(
          `Timed out waiting for invocation ${invocationId}; it is still in state `
            + `"${invocation.state}" and may still execute. Re-read it rather than resubmitting.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/**
 * True when the outcome is genuinely unknown and a person must look.
 *
 * Exported because the alternative is every caller writing
 * `state === "execution_indeterminate"` and half of them lumping it in with
 * failure - which is the one classification that leads to a duplicate send.
 */
export function needsHumanResolution(invocation: ActionInvocation): boolean {
  return invocation.state === "execution_indeterminate";
}

/** True when the Action ran and Contro1 observed the provider's response. */
export function didExecute(invocation: ActionInvocation): boolean {
  return invocation.state === "executed";
}
