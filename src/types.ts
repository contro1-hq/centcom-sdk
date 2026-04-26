export type RequestState =
  | "created" | "validated" | "queued" | "assigned" | "viewed"
  | "answered" | "callback_pending" | "callback_delivered" | "callback_failed"
  | "closed" | "broadcasted" | "escalated" | "reassigned" | "expired" | "cancelled";

export type InteractionType = "yes_no" | "free_text" | "approval";
export type Priority = "normal" | "urgent";
export type ApprovalPolicyMode = "single" | "all_of" | "any_of" | "threshold";

export interface ApprovalPolicy {
  mode?: ApprovalPolicyMode;
  required_approvals?: number;
  required_roles?: string[];
  required_department_ids?: string[];
  separation_of_duties?: boolean;
  fail_closed_on_timeout?: boolean;
}

export interface CentcomConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface CreateRequestParams {
  type: InteractionType;
  context: string;
  question: string;
  callback_url?: string;
  priority?: Priority;
  required_role?: string;
  approval_policy?: ApprovalPolicy;
  response_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sla_minutes?: number;
  idempotency_key?: string;
}

export interface StateHistoryEntry {
  state: RequestState;
  timestamp: string;
  actor: string;
  details?: string;
}

export interface CentcomRequest {
  id: string;
  state: RequestState;
  type: InteractionType;
  context: string;
  question: string;
  priority: Priority;
  required_role?: string;
  approval_policy?: ApprovalPolicy;
  approval_records?: Array<{
    operator_id: string;
    operator_name_snapshot?: string;
    department_snapshot?: string;
    decision: "approved" | "denied" | "escalated";
    comment?: string;
    created_at: string;
  }>;
  response?: Record<string, unknown> | null;
  responded_by?: string | null;
  responded_at?: string | null;
  state_history: StateHistoryEntry[];
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface WebhookPayload {
  request_id: string;
  state: "answered" | "expired" | "cancelled";
  response: Record<string, unknown> | null;
  responded_by: string | null;
  responded_at: string | null;
  metadata: Record<string, unknown> | null;
}
