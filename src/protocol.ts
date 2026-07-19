import type { CentcomRequest, CreateRequestParams, Priority, RetrievedContext, SubAgent, ToolCall } from './types.js';

export const CONTRO1_REQUEST_TYPES = ['approval', 'input', 'decision', 'review'] as const;
export type Contro1RequestType = (typeof CONTRO1_REQUEST_TYPES)[number];

export const CONTRO1_CONTINUATION_MODES = ['decision', 'instruction'] as const;
export type Contro1ContinuationMode = (typeof CONTRO1_CONTINUATION_MODES)[number];

export const CONTRO1_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Contro1Priority = (typeof CONTRO1_PRIORITIES)[number];

export const CONTRO1_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type Contro1RiskLevel = (typeof CONTRO1_RISK_LEVELS)[number];

export const CONTRO1_STATUSES = ['approved', 'denied', 'cancelled', 'timed_out', 'provided_input', 'resolved'] as const;
export type Contro1Status = (typeof CONTRO1_STATUSES)[number];

export type ApprovalPolicy = {
  mode?: 'single' | 'all_of' | 'any_of' | 'threshold';
  required_approvals?: number;
  required_roles?: string[];
  required_department_ids?: string[];
  separation_of_duties?: boolean;
  fail_closed_on_timeout?: boolean;
};

export type ApprovalRequirements = {
  required_approvals?: number;
  required_roles?: string[];
  must_include_roles?: string[];
};

export type PolicyContext = {
  source?: string;
  policy_name?: string;
  rule_id?: string;
  rule_reason?: string;
  policy_version?: string;
  enforcement?: string;
};

export type DecisionContext = {
  risk_level?: Contro1RiskLevel;
  policy_trigger?: string;
  approval_requirements?: ApprovalRequirements;
  policy_context?: PolicyContext;
};

export type Contro1Request = {
  id?: string;
  title: string;
  description?: string;
  request_type: Contro1RequestType;
  correlation_id?: string;
  external_request_id?: string;
  thread_id?: string;
  in_reply_to?: {
    type: 'request' | 'audit_record';
    id: string;
  };
  trace_id?: string;
  parent_trace_id?: string;
  tool_calls?: ToolCall[];
  sub_agents?: SubAgent[];
  retrieved_context?: RetrievedContext[];
  source: {
    integration: string;
    framework?: string;
    workflow_id?: string;
    run_id?: string;
    session_id?: string;
  };
  routing?: {
    department?: string;
    required_role?: string;
    priority?: Contro1Priority;
    sla_minutes?: number;
  };
  actor?: {
    user_id?: string;
    user_email?: string;
    agent_id?: string;
    agent_name?: string;
  };
  context?: {
    tool_name?: string;
    tool_input?: unknown;
    action_type?: string;
    resource?: string;
    environment?: string;
    summary?: string;
    action?: { tool: string; input?: unknown };
    machine_observed?: Record<string, unknown>;
    agent_reported?: Record<string, unknown>;
  };
  continuation: {
    mode: Contro1ContinuationMode;
    callback_url?: string;
    webhook_url?: string;
    resume_token?: string;
    expires_at?: string;
  };
  approval_policy?: ApprovalPolicy;
  risk_level?: Contro1RiskLevel;
  policy_trigger?: string;
  policy_context?: PolicyContext;
  approval_comment_required?: boolean;
  approval_requirements?: ApprovalRequirements;
  decision_context?: DecisionContext;
  metadata?: Record<string, unknown>;
};

export type Contro1Response = {
  request_id: string;
  status: Contro1Status;
  operator?: {
    id?: string;
    name?: string;
    department?: string;
  };
  message?: string;
  structured_response?: Record<string, unknown>;
  decision_type?: 'approve' | 'reject' | 'respond';
  resolved_at: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

function mapPriority(priority?: Contro1Priority): Priority {
  if (!priority) return 'normal';
  return priority === 'high' || priority === 'urgent' ? 'urgent' : 'normal';
}

function mapRequestType(requestType: Contro1RequestType): CreateRequestParams['type'] {
  switch (requestType) {
    case 'input':
      return 'free_text';
    case 'decision':
      return 'yes_no';
    case 'review':
    case 'approval':
    default:
      return 'approval';
  }
}

function buildContextText(request: Contro1Request): string {
  const blocks: string[] = [];
  if (request.description) blocks.push(request.description.trim());

  if (request.context?.summary) {
    blocks.push(`Summary: ${request.context.summary}`);
  }
  if (request.context?.tool_name) {
    blocks.push(`Tool: ${request.context.tool_name}`);
  }
  if (request.context?.action_type) {
    blocks.push(`Action: ${request.context.action_type}`);
  }
  if (request.context?.resource) {
    blocks.push(`Resource: ${request.context.resource}`);
  }
  if (request.context?.environment) {
    blocks.push(`Environment: ${request.context.environment}`);
  }
  if (request.context?.tool_input !== undefined) {
    blocks.push(`Tool input: ${JSON.stringify(request.context.tool_input)}`);
  }

  return blocks.join('\n').trim() || request.title;
}

function readMessageFromResponse(response: Record<string, unknown> | null | undefined): string | undefined {
  if (!response) return undefined;
  if (typeof response.message === 'string' && response.message.trim()) return response.message;
  if (typeof response.comment === 'string' && response.comment.trim()) return response.comment;
  if (typeof response.reason === 'string' && response.reason.trim()) return response.reason;
  if (typeof response.value === 'string' && response.value.trim()) return response.value;
  return undefined;
}

function inferStatus(request: CentcomRequest): Contro1Status {
  if (request.state === 'cancelled') return 'cancelled';
  if (request.state === 'expired') return 'timed_out';

  const response = request.response as Record<string, unknown> | null | undefined;
  if (response && typeof response.approved === 'boolean') {
    return response.approved ? 'approved' : 'denied';
  }
  if (response && typeof response.value === 'boolean') {
    return response.value ? 'approved' : 'denied';
  }

  // Legacy free-text replies have no explicit approval flag.
  return request.state === 'answered' ? 'approved' : 'timed_out';
}

export function validateContro1Request(request: Contro1Request): ValidationResult {
  const errors: string[] = [];

  if (!request.title || !request.title.trim()) {
    errors.push('title is required');
  }

  if (!CONTRO1_REQUEST_TYPES.includes(request.request_type)) {
    errors.push(`request_type must be one of: ${CONTRO1_REQUEST_TYPES.join(', ')}`);
  }

  if (!request.source?.integration?.trim()) {
    errors.push('source.integration is required');
  }

  if (!request.continuation || !CONTRO1_CONTINUATION_MODES.includes(request.continuation.mode)) {
    errors.push(`continuation.mode must be one of: ${CONTRO1_CONTINUATION_MODES.join(', ')}`);
  }

  if (request.routing?.priority && !CONTRO1_PRIORITIES.includes(request.routing.priority)) {
    errors.push(`routing.priority must be one of: ${CONTRO1_PRIORITIES.join(', ')}`);
  }

  if (request.routing?.sla_minutes !== undefined && request.routing.sla_minutes <= 0) {
    errors.push('routing.sla_minutes must be greater than 0');
  }
  if (request.risk_level && !CONTRO1_RISK_LEVELS.includes(request.risk_level)) {
    errors.push(`risk_level must be one of: ${CONTRO1_RISK_LEVELS.join(', ')}`);
  }
  if (request.policy_trigger !== undefined && !request.policy_trigger.trim()) {
    errors.push('policy_trigger must be non-empty when provided');
  }
  if (request.thread_id && !/^thr_[A-Za-z0-9_-]{1,64}$/.test(request.thread_id)) {
    errors.push('thread_id must match thr_[A-Za-z0-9_-]{1,64}');
  }
  if (request.trace_id && !/^trc_[A-Za-z0-9_-]{1,64}$/.test(request.trace_id)) {
    errors.push('trace_id must match trc_[A-Za-z0-9_-]{1,64}');
  }
  if (request.parent_trace_id && !/^trc_[A-Za-z0-9_-]{1,64}$/.test(request.parent_trace_id)) {
    errors.push('parent_trace_id must match trc_[A-Za-z0-9_-]{1,64}');
  }

  return { valid: errors.length === 0, errors };
}

export function validateContro1Response(response: Contro1Response): ValidationResult {
  const errors: string[] = [];

  if (!response.request_id?.trim()) {
    errors.push('request_id is required');
  }

  if (!CONTRO1_STATUSES.includes(response.status)) {
    errors.push(`status must be one of: ${CONTRO1_STATUSES.join(', ')}`);
  }

  if (!response.resolved_at?.trim()) {
    errors.push('resolved_at is required');
  }

  return { valid: errors.length === 0, errors };
}

export function toLegacyCreateRequestParams(request: Contro1Request): CreateRequestParams {
  const metadata: Record<string, unknown> = {
    ...(request.metadata || {}),
    protocol_version: 'integration-v1',
    request_type: request.request_type,
    source: request.source,
    routing: request.routing,
    actor: request.actor,
    context: request.context,
    continuation: request.continuation,
  };

  const decisionContext: DecisionContext = {
    ...(request.decision_context || {}),
  };
  if (request.risk_level) decisionContext.risk_level = request.risk_level;
  if (request.policy_trigger) decisionContext.policy_trigger = request.policy_trigger;
  if (request.policy_context) decisionContext.policy_context = request.policy_context;
  if (request.approval_requirements) decisionContext.approval_requirements = request.approval_requirements;
  if (Object.keys(decisionContext).length > 0) {
    metadata.decision_context = decisionContext;
  }
  if (request.risk_level) metadata.risk_level = request.risk_level;
  if (request.policy_trigger) metadata.policy_trigger = request.policy_trigger;
  if (request.policy_context) metadata.policy_context = request.policy_context;
  if (request.approval_comment_required !== undefined) {
    metadata.approval_comment_required = request.approval_comment_required;
  }
  if (request.approval_requirements) metadata.approval_requirements = request.approval_requirements;

  if (request.correlation_id) {
    metadata.correlation_id = request.correlation_id;
  }
  if (request.external_request_id) {
    metadata.external_request_id = request.external_request_id;
  }
  if (request.thread_id) {
    metadata.thread_id = request.thread_id;
  }
  if (request.in_reply_to) {
    metadata.in_reply_to = request.in_reply_to;
  }
  if (request.tool_calls?.length) {
    metadata.tool_calls = request.tool_calls;
  }
  if (request.sub_agents?.length) {
    metadata.sub_agents = request.sub_agents;
  }
  if (request.retrieved_context?.length) {
    metadata.retrieved_context = request.retrieved_context;
  }

  return {
    type: mapRequestType(request.request_type),
    question: request.title,
    context: buildContextText(request),
    callback_url: request.continuation.callback_url || request.continuation.webhook_url,
    priority: mapPriority(request.routing?.priority),
    required_role: request.routing?.required_role,
    metadata,
    approval_policy: request.approval_policy,
    risk_level: request.risk_level,
    policy_trigger: request.policy_trigger,
    policy_context: request.policy_context,
    approval_comment_required: request.approval_comment_required,
    approval_requirements: request.approval_requirements,
    thread_id: request.thread_id,
    in_reply_to: request.in_reply_to,
    trace_id: request.trace_id,
    parent_trace_id: request.parent_trace_id,
    tool_calls: request.tool_calls,
    sub_agents: request.sub_agents,
    retrieved_context: request.retrieved_context,
    sla_minutes: request.routing?.sla_minutes,
    idempotency_key: request.external_request_id || request.correlation_id || request.source.run_id,
  };
}

export function fromLegacyRequest(request: CentcomRequest): Contro1Response {
  const response = (request.response || null) as Record<string, unknown> | null;
  const metadata = (request.metadata || {}) as Record<string, unknown>;
  const operator = (response?.operator || metadata.operator) as Record<string, unknown> | undefined;
  const canonicalDecision = response?.decision_type;
  const decisionType = canonicalDecision === 'approve' || canonicalDecision === 'reject' || canonicalDecision === 'respond'
    ? canonicalDecision
    : request.type === 'approval' && typeof response?.approved === 'boolean'
      ? (response.approved ? 'approve' : 'reject')
      : response
        ? 'respond'
        : undefined;

  return {
    request_id: request.id,
    status: inferStatus(request),
    operator: operator ? {
      id: typeof operator.id === 'string' ? operator.id : undefined,
      name: typeof operator.name === 'string' ? operator.name : request.responded_by || undefined,
      department: typeof operator.department === 'string' ? operator.department : undefined,
    } : (request.responded_by ? { name: request.responded_by } : undefined),
    message: readMessageFromResponse(response),
    structured_response: response || undefined,
    decision_type: decisionType,
    resolved_at: request.responded_at || request.created_at,
  };
}
