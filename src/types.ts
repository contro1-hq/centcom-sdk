export type RequestState =
  | 'created' | 'validated' | 'queued' | 'assigned' | 'viewed'
  | 'answered' | 'callback_pending' | 'callback_delivered' | 'callback_failed'
  | 'closed' | 'broadcasted' | 'escalated' | 'reassigned' | 'expired' | 'cancelled';

export type InteractionType = 'yes_no' | 'free_text' | 'approval';
export type Priority = 'normal' | 'urgent';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type QueryValue = string | number | boolean | Array<string | number | boolean> | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface CentcomConfig {
  /** API key (cc_live_xxx or cc_test_xxx) */
  apiKey: string;
  /** Base URL, defaults to https://api.contro1.com/api/centcom/v1 */
  baseUrl?: string;
  /** Request timeout in ms, defaults to 30000 */
  timeout?: number;
}

export interface CreateRequestParams {
  type: InteractionType;
  context: string;
  question: string;
  callback_url?: string;
  priority?: Priority;
  required_role?: string;
  response_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  thread_id?: string;
  in_reply_to?: ThreadReference;
  trace_id?: string;
  parent_trace_id?: string;
  tool_calls?: ToolCall[];
  sub_agents?: SubAgent[];
  retrieved_context?: RetrievedContext[];
  sla_minutes?: number;
  risk_level?: RiskLevel;
  policy_trigger?: string;
  policy_context?: PolicyContext;
  approval_comment_required?: boolean;
  approval_requirements?: ApprovalRequirements;
  decision_context?: DecisionContext;
  approval_policy?: ApprovalPolicy;
  external_request_id?: string;
  correlation_id?: string;
  idempotency_key?: string;
}

export interface ApprovalPolicy {
  mode?: 'single' | 'all_of' | 'any_of' | 'threshold';
  required_approvals?: number;
  required_roles?: string[];
  required_department_ids?: string[];
  separation_of_duties?: boolean;
  fail_closed_on_timeout?: boolean;
}

export interface ApprovalRequirements {
  required_approvals?: number;
  required_roles?: string[];
  must_include_roles?: string[];
}

export interface PolicyContext {
  source?: string;
  policy_name?: string;
  rule_id?: string;
  rule_reason?: string;
  policy_version?: string;
  enforcement?: string;
}

export interface DecisionContext {
  risk_level?: RiskLevel;
  policy_trigger?: string;
  approval_requirements?: ApprovalRequirements;
  policy_context?: PolicyContext;
  reviewer_mappings?: ReviewerMapping[];
  mapping_status?: 'mapped' | 'unmapped' | 'fallback_active' | 'needs_setup';
  policy_warnings?: PolicyWarning[];
  routing_coverage?: RoutingCoverageEvent[];
}

export interface ThreadReference {
  type: 'request' | 'audit_record';
  id: string;
}

export interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
  output_summary?: string;
  outcome?: 'success' | 'failure' | 'partial';
  started_at?: string;
  ended_at?: string;
  error?: string;
}

export interface SubAgent {
  agent_id: string;
  name?: string;
  verification?: 'verified' | 'claimed';
  trace_id?: string;
  action_summary?: string;
}

export interface RetrievedContext {
  source: string;
  uri?: string;
  snippet?: string;
  content_hash?: string;
  score?: number;
  retrieved_at?: string;
}

export interface ReviewerMappingTarget {
  type: 'operator' | 'department' | 'role';
  id: string;
  label?: string;
}

export interface ReviewerMapping {
  external_role: string;
  display_name?: string;
  primary_targets?: ReviewerMappingTarget[];
  fallback_targets?: ReviewerMappingTarget[];
  remembered?: boolean;
  status?: 'mapped' | 'unmapped' | 'fallback_active' | 'needs_setup';
}

export interface PolicyWarning {
  code: string;
  message: string;
  role?: string;
  required?: number;
  available?: number;
}

export interface RoutingCoverageEvent {
  external_role: string;
  display_name?: string;
  status: 'primary_available' | 'fallback_active' | 'admin_fallback_required' | 'unmapped' | 'capacity_missing';
  intended_operator_ids?: string[];
  intended_operator_names?: string[];
  fallback_operator_ids?: string[];
  fallback_operator_names?: string[];
  resolved_operator_ids?: string[];
  resolved_operator_names?: string[];
  warning_code?: string;
  message?: string;
  configure_url?: string;
}

export interface AuditRecordCreateParams {
  action: string;
  summary: string;
  source: {
    integration: string;
    workflow_id?: string;
    run_id?: string;
  };
  actor?: {
    agent_id?: string;
    agent_name?: string;
    user_id?: string;
  };
  resource?: {
    type?: string;
    id?: string;
    uri?: string;
  };
  outcome?: 'success' | 'failure' | 'partial';
  severity?: 'info' | 'notice' | 'warning';
  correlation_id?: string;
  external_request_id?: string;
  risk_level?: RiskLevel;
  policy_trigger?: string;
  approval_requirements?: ApprovalRequirements;
  decision_context?: DecisionContext;
  tags?: string[];
  metadata?: Record<string, unknown>;
  occurred_at?: string;
  thread_id?: string;
  in_reply_to?: ThreadReference;
  trace_id?: string;
  parent_trace_id?: string;
  tool_calls?: ToolCall[];
}

export interface AuditRecord {
  id: string;
  recorded_at: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial';
  org_id: string;
  thread_id?: string | null;
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
  response?: Record<string, unknown> | null;
  responded_by?: string | null;
  responded_at?: string | null;
  state_history: StateHistoryEntry[];
  metadata?: Record<string, unknown>;
  thread_id?: string | null;
  trace_id?: string | null;
  parent_trace_id?: string | null;
  risk_level?: RiskLevel | null;
  policy_trigger?: string | null;
  policy_context?: PolicyContext | null;
  approval_comment_required?: boolean;
  decision_context?: DecisionContext | null;
  protocol_response?: Record<string, unknown>;
  created_at: string;
}

export interface WebhookPayload {
  request_id: string;
  state: 'answered' | 'expired' | 'cancelled';
  response: Record<string, unknown> | null;
  responded_by: string | null;
  responded_at: string | null;
  metadata: Record<string, unknown> | null;
  risk_level?: RiskLevel | null;
  policy_trigger?: string | null;
  policy_context?: PolicyContext | null;
  approval_comment_required?: boolean;
  decision_context?: DecisionContext | null;
  protocol_response?: Record<string, unknown>;
}

export interface ListRequestsParams extends QueryParams {
  thread_id?: string;
  state?: RequestState;
  agent_id?: string;
  limit?: number;
}

export interface ListAuditRecordsParams extends QueryParams {
  action?: string;
  actor_agent_id?: string;
  actor_user_id?: string;
  source_integration?: string;
  workflow_id?: string;
  outcome?: 'success' | 'failure' | 'partial';
  severity?: 'info' | 'notice' | 'warning';
  correlation_id?: string;
  external_request_id?: string;
  thread_id?: string;
  tags?: string[];
  from?: string;
  to?: string;
  cursor?: string;
  q?: string;
  limit?: number;
}

export interface AgentRegisterParams {
  name: string;
  framework?: string;
  description?: string;
  owner?: string;
}

export interface AgentListParams extends QueryParams {
  framework?: string;
  verification_status?: 'verified' | 'claimed';
  status?: string;
}

export interface AgentEvidenceOptions extends QueryParams {
  limit?: number;
  format?: 'json' | 'csv';
}
