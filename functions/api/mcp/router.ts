import { Hono } from "hono";
import { jsonNoStore } from "../../_lib/http";
import { requireAdminFromRequest, getAdminBySessionClaims, type AdminSessionTokenClaims } from "../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../_lib/auth/proposal-access";
import { getEventBySlug } from "../../_lib/services/events";
import {
  buildProposalReviewAuditDetails,
  listProposalReviews,
  upsertProposalReview,
  type ProposalListRecord,
  type ProposalRecord,
  type ProposalReviewRecord,
} from "../../_lib/services/proposals";
import { writeAuditLog } from "../../_lib/services/audit";
import { all, first, run } from "../../_lib/db/queries";
import { signJwt, verifyJwt } from "../../_lib/utils/jwt";
import { sha256Hex } from "../../_lib/utils/crypto";
import { addHours, nowIso } from "../../_lib/utils/time";
import { uuid } from "../../_lib/utils/ids";
import { AppError, isAppError } from "../../_lib/errors";
import { discovery, toolsForProfile } from "./tools";
import type { AuthAdmin, Env } from "../../_lib/types";

export type McpProfile = "all" | "events";
type Recommendation = "accept" | "reject" | "needs-work";
type ReviewStatus = "draft" | "submitted";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface McpToolCallParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

interface OAuthCodeClaims {
  typ: "mcp-oauth-code";
  sub: string;
  authorizing_sid: string;
  authorization_code_session_id: string;
  email: string;
  role: string;
  scopes: string[];
  client_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  resource: string;
  exp: number;
}

interface McpAccessTokenClaims extends Omit<AdminSessionTokenClaims, "typ"> {
  typ: "mcp-access";
  aud: string;
  client_id: string;
}

interface McpRefreshTokenClaims {
  typ: "mcp-refresh";
  sub: string;
  sid: string;
  email: string;
  role: string;
  scopes: string[];
  aud: string;
  client_id: string;
  exp: number;
}

const MCP_SCOPES = ["mcp:events:read", "mcp:reviews:write"];
const MCP_ACCESS_TOKEN_TTL_HOURS = 1;
const MCP_CLIENT_SESSION_TTL_HOURS = 24 * 30;
const MCP_AUTHORIZATION_CODE_TTL_SECONDS = 300;
const encoder = new TextEncoder();

function originForRequest(request: Request): string {
  return new URL(request.url).origin;
}

function mcpResourceForRequest(request: Request): string {
  return `${originForRequest(request)}/api/mcp`;
}

function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES, "offline_access"],
  };
}

function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

export function handleOAuthAuthorizationServerMetadata(request: Request): Response {
  return jsonNoStore(authorizationServerMetadata(originForRequest(request)));
}

export function handleOAuthProtectedResourceMetadata(request: Request): Response {
  return jsonNoStore(protectedResourceMetadata(originForRequest(request)));
}

function jsonRpcResult(request: JsonRpcRequest, result: unknown): Response {
  return jsonNoStore({ jsonrpc: "2.0", id: request.id ?? null, result });
}

function jsonRpcError(request: JsonRpcRequest, code: number, message: string): Response {
  return jsonNoStore({ jsonrpc: "2.0", id: request.id ?? null, error: { code, message } });
}

function jsonRpcToolResult(request: JsonRpcRequest, data: unknown): Response {
  return jsonRpcResult(request, {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  });
}

function unauthorizedMcpResponse(request: Request): Response {
  const origin = originForRequest(request);
  return jsonNoStore(
    { error: "authorization_required", error_description: "Authenticate this MCP server from the client /mcp panel." },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  );
}

function parseBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function isMcpAccessTokenClaims(claims: object): claims is McpAccessTokenClaims {
  const candidate = claims as Partial<McpAccessTokenClaims>;
  return (
    candidate.typ === "mcp-access" &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.aud === "string" &&
    typeof candidate.client_id === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    typeof candidate.exp === "number"
  );
}

function isOAuthCodeClaims(claims: object): claims is OAuthCodeClaims {
  const candidate = claims as Partial<OAuthCodeClaims>;
  return (
    candidate.typ === "mcp-oauth-code" &&
    typeof candidate.sub === "string" &&
    typeof candidate.authorizing_sid === "string" &&
    typeof candidate.authorization_code_session_id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    typeof candidate.client_id === "string" &&
    typeof candidate.redirect_uri === "string" &&
    (candidate.code_challenge === null || typeof candidate.code_challenge === "string") &&
    (candidate.code_challenge_method === null || typeof candidate.code_challenge_method === "string") &&
    typeof candidate.resource === "string" &&
    typeof candidate.exp === "number"
  );
}

function isAllowedLoopbackRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:") {
    return false;
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
    return false;
  }
  if (!url.port) {
    return false;
  }
  return url.pathname === "/callback";
}

function requireLoopbackRedirectUri(value: string): string {
  if (!isAllowedLoopbackRedirectUri(value)) {
    throw new AppError(
      400,
      "OAUTH_REDIRECT_URI_INVALID",
      "MCP OAuth redirect_uri must be a loopback callback URL such as http://localhost:12345/callback",
    );
  }
  return value;
}

function isMcpRefreshTokenClaims(claims: object): claims is McpRefreshTokenClaims {
  const candidate = claims as Partial<McpRefreshTokenClaims>;
  return (
    candidate.typ === "mcp-refresh" &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.aud === "string" &&
    typeof candidate.client_id === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    typeof candidate.exp === "number"
  );
}

function expFromIso(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) {
    throw new AppError(500, "INVALID_SESSION_EXPIRY", "Unable to issue MCP access token");
  }
  return Math.floor(ms / 1000);
}

function secondsUntil(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function accessTokenExpiresAt(sessionExpiresAt: string): string {
  const requested = new Date(addHours(nowIso(), MCP_ACCESS_TOKEN_TTL_HOURS)).getTime();
  const sessionExpiry = new Date(sessionExpiresAt).getTime();
  return new Date(Math.min(requested, sessionExpiry)).toISOString();
}

async function signMcpAccessToken(
  env: Env,
  payload: { admin: AuthAdmin; sessionId: string; sessionExpiresAt: string; clientId: string; resource: string },
): Promise<{ accessToken: string; expiresAt: string }> {
  if (!env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const expiresAt = accessTokenExpiresAt(payload.sessionExpiresAt);
  const accessToken = await signJwt(env.INTERNAL_SIGNING_SECRET, {
    typ: "mcp-access",
    sub: payload.admin.id,
    sid: payload.sessionId,
    email: payload.admin.email,
    role: payload.admin.role,
    scopes: MCP_SCOPES,
    aud: payload.resource,
    client_id: payload.clientId,
    exp: expFromIso(expiresAt),
  });

  return { accessToken, expiresAt };
}

async function issueMcpClientSession(
  env: Env,
  payload: { admin: AuthAdmin; clientId: string; resource: string },
): Promise<{
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}> {
  if (!env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const sessionId = uuid();
  const now = nowIso();
  const refreshTokenExpiresAt = addHours(now, MCP_CLIENT_SESSION_TTL_HOURS);
  const refreshToken = await signJwt(env.INTERNAL_SIGNING_SECRET, {
    typ: "mcp-refresh",
    sub: payload.admin.id,
    sid: sessionId,
    email: payload.admin.email,
    role: payload.admin.role,
    scopes: MCP_SCOPES,
    aud: payload.resource,
    client_id: payload.clientId,
    exp: expFromIso(refreshTokenExpiresAt),
  });
  const { accessToken, expiresAt: accessTokenExpiresAt } = await signMcpAccessToken(env, {
    admin: payload.admin,
    sessionId,
    sessionExpiresAt: refreshTokenExpiresAt,
    clientId: payload.clientId,
    resource: payload.resource,
  });

  await run(
    env.DB,
    `INSERT INTO sessions (id, user_id, session_type, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, 'api', ?, ?, NULL, ?)`,
    [sessionId, payload.admin.id, await sha256Hex(refreshToken), refreshTokenExpiresAt, now],
  );

  await writeAuditLog(env.DB, "admin", payload.admin.id, "mcp_session_created", "admin_session", sessionId, {
    clientId: payload.clientId,
    resource: payload.resource,
    expiresAt: refreshTokenExpiresAt,
  });

  return { accessToken, refreshToken, sessionId, accessTokenExpiresAt, refreshTokenExpiresAt };
}

async function getMcpRefreshActor(env: Env, claims: McpRefreshTokenClaims, refreshToken: string): Promise<AuthAdmin> {
  const row = await first<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: string;
    revoked_at: string | null;
    email: string;
    role: string;
  }>(
    env.DB,
    `SELECT s.id, s.user_id, s.token_hash, s.expires_at, s.revoked_at, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.session_type = 'api' AND u.active = 1 AND u.role = 'admin'`,
    [claims.sid, claims.sub],
  );

  if (!row || row.token_hash !== (await sha256Hex(refreshToken))) {
    throw new AppError(401, "AUTH_INVALID", "Invalid MCP refresh token");
  }
  if (row.revoked_at) {
    throw new AppError(401, "AUTH_REVOKED", "MCP session is revoked");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "MCP session expired");
  }

  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    scopes: claims.scopes,
    sessionId: row.id,
    expiresAt: row.expires_at,
  };
}

async function requireMcpActor(env: Env, request: Request): Promise<AuthAdmin> {
  const token = parseBearerToken(request);
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  }
  if (!env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const verified = await verifyJwt<object>(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      "Invalid MCP access token",
    );
  }
  if (!isMcpAccessTokenClaims(verified.claims)) {
    throw new AppError(401, "AUTH_INVALID", "Invalid MCP access token");
  }
  if (verified.claims.aud !== mcpResourceForRequest(request)) {
    throw new AppError(401, "AUTH_INVALID", "MCP access token audience does not match this server");
  }

  return getAdminBySessionClaims(env.DB, { ...verified.claims, typ: "admin-session" });
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(400, "MCP_ARGUMENT_INVALID", `${name} is required`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, name: string): string | null {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalLimit(args: Record<string, unknown>): number {
  const raw = args.limit;
  const number = typeof raw === "number" ? raw : Number(raw ?? 50);
  return Math.min(200, Math.max(1, Number.isFinite(number) ? Math.floor(number) : 50));
}

function optionalOffset(args: Record<string, unknown>): number {
  const raw = args.offset;
  const number = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Math.max(0, Number.isFinite(number) ? Math.floor(number) : 0);
}

function requireRecommendation(args: Record<string, unknown>): Recommendation {
  const value = args.recommendation;
  if (value === "accept" || value === "reject" || value === "needs-work") {
    return value;
  }
  throw new AppError(400, "MCP_ARGUMENT_INVALID", "recommendation must be accept, reject, or needs-work");
}

function requireScore(args: Record<string, unknown>): number {
  const value = args.score;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 10) {
    throw new AppError(400, "MCP_ARGUMENT_INVALID", "score must be an integer from 1 to 10");
  }
  return number;
}

async function requireProposalReviewAccess(env: Env, proposalId: string, actor: AuthAdmin): Promise<ProposalRecord> {
  const proposal = await first<ProposalRecord>(env.DB, "SELECT * FROM session_proposals WHERE id = ?", [proposalId]);
  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }
  const access = await getProposalAccessForEvent(env.DB, proposal.event_id, actor);
  if (!access.canReview) {
    throw new AppError(403, "PROPOSAL_ACCESS_DENIED", "You do not have review access to this event");
  }
  return proposal;
}

async function listEvents(env: Env, actor: AuthAdmin): Promise<unknown> {
  const rows = await all<{
    id: string;
    slug: string;
    name: string;
    timezone: string;
    starts_at: string | null;
    ends_at: string | null;
    base_path: string | null;
    permissions: string | null;
    proposal_count: number;
  }>(
    env.DB,
    `SELECT
       e.id, e.slug, e.name, e.timezone, e.starts_at, e.ends_at, e.base_path,
       GROUP_CONCAT(DISTINCT ep.permission) AS permissions,
       COALESCE(pc.proposal_count, 0) AS proposal_count
     FROM events e
     LEFT JOIN event_permissions ep ON ep.event_id = e.id AND (ep.user_id = ? OR ep.user_email = ?)
     LEFT JOIN (
       SELECT event_id, COUNT(*) AS proposal_count
       FROM session_proposals
       WHERE withdrawn_at IS NULL
       GROUP BY event_id
     ) pc ON pc.event_id = e.id
     WHERE ? = 'admin' OR ep.id IS NOT NULL
     GROUP BY e.id
     ORDER BY COALESCE(e.starts_at, '9999') DESC`,
    [actor.id, actor.email.toLowerCase(), actor.role],
  );

  return {
    events: rows.map((row) => ({
      ...row,
      permissions: actor.role === "admin" ? ["admin"] : (row.permissions?.split(",").filter(Boolean) ?? []),
      canReview: actor.role === "admin" || Boolean(row.permissions),
    })),
  };
}

async function listProposals(env: Env, actor: AuthAdmin, args: Record<string, unknown>): Promise<unknown> {
  const event = await getEventBySlug(env.DB, requireString(args, "eventSlug"));
  const access = await getProposalAccessForEvent(env.DB, event.id, actor);
  if (!access.canReview) {
    throw new AppError(403, "PROPOSAL_ACCESS_DENIED", "You do not have review access to this event");
  }

  const status = optionalString(args, "status");
  const reviewStatus = optionalString(args, "reviewStatus") as ReviewStatus | null;
  const limit = optionalLimit(args);
  const offset = optionalOffset(args);
  const conditions = ["sp.event_id = ?"];
  const params: unknown[] = [event.id];

  if (status) {
    conditions.push("sp.status = ?");
    params.push(status);
  }
  if (reviewStatus) {
    if (reviewStatus !== "draft" && reviewStatus !== "submitted") {
      throw new AppError(400, "MCP_ARGUMENT_INVALID", "reviewStatus must be draft or submitted");
    }
    conditions.push("my_review.status = ?");
    params.push(reviewStatus);
  }

  const rows = await all<ProposalListRecord & { my_review_status: string | null; my_review_score: number | null }>(
    env.DB,
    `SELECT
       sp.*,
       u.email AS proposer_email,
       u.first_name AS proposer_first_name,
       u.last_name AS proposer_last_name,
       COALESCE(rv.review_count, 0) AS review_count,
       pd.final_status AS decision_status,
       pd.decision_note AS decision_note,
       pd.decided_at AS decision_decided_at,
       my_review.status AS my_review_status,
       my_review.score AS my_review_score
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     LEFT JOIN (
       SELECT proposal_id, COUNT(*) AS review_count
       FROM proposal_reviews
       WHERE status = 'submitted'
       GROUP BY proposal_id
     ) rv ON rv.proposal_id = sp.id
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     LEFT JOIN proposal_reviews my_review ON my_review.proposal_id = sp.id AND my_review.reviewer_user_id = ?
     WHERE ${conditions.join(" AND ")}
     ORDER BY sp.submitted_at DESC
     LIMIT ? OFFSET ?`,
    [actor.id, ...params, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  const proposals = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
    id: row.id,
    status: row.status,
    proposalType: row.proposal_type,
    title: row.title,
    submittedAt: row.submitted_at,
    proposer: {
      email: row.proposer_email,
      firstName: row.proposer_first_name,
      lastName: row.proposer_last_name,
    },
    submittedReviewCount: row.review_count,
    myReview: row.my_review_status
      ? {
          status: row.my_review_status,
          score: row.my_review_score,
        }
      : null,
    decisionStatus: row.decision_status,
  }));

  return { event: { id: event.id, slug: event.slug, name: event.name }, proposals, page: { limit, offset, hasMore } };
}

async function readProposal(env: Env, actor: AuthAdmin, args: Record<string, unknown>): Promise<unknown> {
  const proposal = await requireProposalReviewAccess(env, requireString(args, "proposalId"), actor);
  const proposer = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    env.DB,
    "SELECT email, first_name, last_name FROM users WHERE id = ?",
    [proposal.proposer_user_id],
  );
  const reviews = await listProposalReviews(env.DB, proposal.id);
  return {
    proposal: {
      id: proposal.id,
      eventId: proposal.event_id,
      status: proposal.status,
      proposalType: proposal.proposal_type,
      title: proposal.title,
      abstract: proposal.abstract,
      details: proposal.details_json ? JSON.parse(proposal.details_json) : null,
      submittedAt: proposal.submitted_at,
      proposer,
    },
    reviews: reviews.map((review) => ({
      id: review.id,
      reviewerEmail: review.reviewer_email,
      recommendation: review.recommendation,
      status: review.status,
      score: review.score,
      reviewerComment: review.reviewer_comment,
      applicantNote: review.applicant_note,
      submittedAt: review.submitted_at,
      updatedAt: review.updated_at,
    })),
  };
}

async function getMine(env: Env, actor: AuthAdmin, args: Record<string, unknown>): Promise<unknown> {
  const proposal = await requireProposalReviewAccess(env, requireString(args, "proposalId"), actor);
  const review = await first<ProposalReviewRecord>(
    env.DB,
    "SELECT * FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?",
    [proposal.id, actor.id],
  );
  return { proposalId: proposal.id, review };
}

async function saveReview(
  env: Env,
  actor: AuthAdmin,
  args: Record<string, unknown>,
  status: ReviewStatus,
): Promise<unknown> {
  const proposal = await requireProposalReviewAccess(env, requireString(args, "proposalId"), actor);
  const before = await first<ProposalReviewRecord>(
    env.DB,
    "SELECT * FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?",
    [proposal.id, actor.id],
  );
  const review = await upsertProposalReview(env.DB, {
    proposalId: proposal.id,
    reviewerUserId: actor.id,
    recommendation: requireRecommendation(args),
    score: requireScore(args),
    reviewerComment: optionalString(args, "reviewerComment"),
    applicantNote: optionalString(args, "applicantNote"),
    status,
  });
  const changes = buildProposalReviewAuditDetails(
    {
      recommendation: before?.recommendation ?? null,
      status: before?.status ?? null,
      score: before?.score ?? null,
      reviewerComment: before?.reviewer_comment ?? null,
      applicantNote: before?.applicant_note ?? null,
    },
    {
      recommendation: review.recommendation,
      status: review.status,
      score: review.score,
      reviewerComment: review.reviewer_comment,
      applicantNote: review.applicant_note,
    },
  );
  await writeAuditLog(env.DB, "admin", actor.id, "proposal_review_upserted_mcp", "proposal_review", review.id, {
    proposalId: proposal.id,
    changes,
  });
  return { proposalId: proposal.id, review };
}

async function callTool(env: Env, request: Request, body: JsonRpcRequest): Promise<Response> {
  const params = body.params as McpToolCallParams;
  if (!params || typeof params.name !== "string") {
    return jsonRpcError(body, -32602, "tools/call requires a tool name");
  }

  const actor = await requireMcpActor(env, request);
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  switch (params.name) {
    case "events_list":
      return jsonRpcToolResult(body, await listEvents(env, actor));
    case "events_proposals_list":
      return jsonRpcToolResult(body, await listProposals(env, actor, args));
    case "events_proposals_read":
      return jsonRpcToolResult(body, await readProposal(env, actor, args));
    case "events_reviews_get_mine":
      return jsonRpcToolResult(body, await getMine(env, actor, args));
    case "events_reviews_save_draft":
      return jsonRpcToolResult(body, await saveReview(env, actor, args, "draft"));
    case "events_reviews_submit":
      return jsonRpcToolResult(body, await saveReview(env, actor, args, "submitted"));
    default:
      return jsonRpcError(body, -32601, `Unknown tool: ${params.name}`);
  }
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256B64Url(input: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input))));
}

function adminAuthorizeUrl(request: Request): string {
  const url = new URL(request.url);
  const encoded = btoa(JSON.stringify(Object.fromEntries(url.searchParams.entries())));
  return `${originForRequest(request)}/admin/?mcp_authorize=${encodeURIComponent(encoded)}`;
}

async function handleAuthorizeApprove(c: { env: Env; req: { raw: Request } }): Promise<Response> {
  const body = (await c.req.raw.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = requireString(body, "client_id");
  const redirectUri = requireLoopbackRedirectUri(requireString(body, "redirect_uri"));
  const responseType = requireString(body, "response_type");
  if (responseType !== "code") {
    throw new AppError(400, "OAUTH_RESPONSE_TYPE_UNSUPPORTED", "Only authorization code flow is supported");
  }
  const codeChallenge = optionalString(body, "code_challenge");
  const codeChallengeMethod = optionalString(body, "code_challenge_method") ?? (codeChallenge ? "plain" : null);
  if (codeChallengeMethod && codeChallengeMethod !== "plain" && codeChallengeMethod !== "S256") {
    throw new AppError(400, "OAUTH_PKCE_UNSUPPORTED", "Only plain and S256 PKCE methods are supported");
  }

  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  if (!admin.sessionId || !admin.expiresAt) {
    throw new AppError(401, "AUTH_REQUIRED", "An interactive admin session is required");
  }
  if (!c.env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const codeSessionId = uuid();
  const codeExpiresAt = new Date(Date.now() + MCP_AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();
  const code = await signJwt(c.env.INTERNAL_SIGNING_SECRET, {
    typ: "mcp-oauth-code",
    sub: admin.id,
    authorizing_sid: admin.sessionId,
    authorization_code_session_id: codeSessionId,
    email: admin.email,
    role: admin.role,
    scopes: MCP_SCOPES,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    resource: `${originForRequest(c.req.raw)}/api/mcp`,
    exp: Math.floor(Date.now() / 1000) + MCP_AUTHORIZATION_CODE_TTL_SECONDS,
  });

  await run(
    c.env.DB,
    `INSERT INTO sessions (id, user_id, session_type, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, 'api', ?, ?, NULL, ?)`,
    [codeSessionId, admin.id, await sha256Hex(code), codeExpiresAt, nowIso()],
  );

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  const state = optionalString(body, "state");
  if (state) redirect.searchParams.set("state", state);
  return jsonNoStore({ redirectTo: redirect.toString() });
}

async function handleToken(c: { env: Env; req: { raw: Request } }): Promise<Response> {
  if (!c.env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }
  const form = await c.req.raw.formData();
  const grantType = String(form.get("grant_type") ?? "");
  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const clientId = String(form.get("client_id") ?? "");
    const verified = await verifyJwt<object>(c.env.INTERNAL_SIGNING_SECRET, refreshToken);
    if (!verified.ok || !isMcpRefreshTokenClaims(verified.claims) || verified.claims.client_id !== clientId) {
      return jsonNoStore({ error: "invalid_grant" }, 400);
    }
    const admin = await getMcpRefreshActor(c.env, verified.claims, refreshToken);
    const { accessToken, expiresAt } = await signMcpAccessToken(c.env, {
      admin,
      sessionId: verified.claims.sid,
      sessionExpiresAt: admin.expiresAt ?? nowIso(),
      clientId,
      resource: verified.claims.aud,
    });

    return jsonNoStore({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: secondsUntil(expiresAt),
      scope: MCP_SCOPES.join(" "),
    });
  }

  if (grantType !== "authorization_code") {
    return jsonNoStore({ error: "unsupported_grant_type" }, 400);
  }
  const code = String(form.get("code") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = requireLoopbackRedirectUri(String(form.get("redirect_uri") ?? ""));
  const codeVerifier = form.get("code_verifier") ? String(form.get("code_verifier")) : null;
  const verified = await verifyJwt<object>(c.env.INTERNAL_SIGNING_SECRET, code);
  if (!verified.ok || !isOAuthCodeClaims(verified.claims)) {
    return jsonNoStore({ error: "invalid_grant" }, 400);
  }
  if (verified.claims.client_id !== clientId || verified.claims.redirect_uri !== redirectUri) {
    return jsonNoStore({ error: "invalid_grant" }, 400);
  }

  const consume = await run(
    c.env.DB,
    `UPDATE sessions
     SET revoked_at = ?
     WHERE id = ?
       AND user_id = ?
       AND session_type = 'api'
       AND token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > ?`,
    [nowIso(), verified.claims.authorization_code_session_id, verified.claims.sub, await sha256Hex(code), nowIso()],
  );
  if (consume.changes === 0) {
    return jsonNoStore({ error: "invalid_grant" }, 400);
  }

  if (verified.claims.code_challenge) {
    if (!codeVerifier) {
      return jsonNoStore({ error: "invalid_request", error_description: "Missing code_verifier" }, 400);
    }
    const expected = verified.claims.code_challenge_method === "S256" ? await sha256B64Url(codeVerifier) : codeVerifier;
    if (expected !== verified.claims.code_challenge) {
      return jsonNoStore({ error: "invalid_grant" }, 400);
    }
  }

  const admin = await getAdminBySessionClaims(c.env.DB, {
    typ: "admin-session",
    sub: verified.claims.sub,
    sid: verified.claims.authorizing_sid,
    email: verified.claims.email,
    role: verified.claims.role,
    scopes: verified.claims.scopes,
    exp: verified.claims.exp,
  });
  const { accessToken, refreshToken, accessTokenExpiresAt } = await issueMcpClientSession(c.env, {
    admin,
    clientId,
    resource: verified.claims.resource,
  });

  return jsonNoStore({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: secondsUntil(accessTokenExpiresAt),
    scope: MCP_SCOPES.join(" "),
  });
}

async function handleMcpPost(request: Request, env: Env, profile: McpProfile): Promise<Response> {
  const body = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError({ id: null }, -32600, "Invalid JSON-RPC request");
  }

  if (body.method === "initialize") {
    return jsonRpcResult(body, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: {
        name: profile === "events" ? "pkic-events" : "pkic",
        version: "0.1.0",
      },
    });
  }

  if (body.method === "tools/list") {
    return jsonRpcResult(body, { tools: toolsForProfile(profile) });
  }

  if (body.method === "tools/call") {
    try {
      return await callTool(env, request, body);
    } catch (error) {
      if (isAppError(error) && (error.status === 401 || error.status === 403)) {
        return unauthorizedMcpResponse(request);
      }
      if (isAppError(error)) {
        return jsonRpcError(body, -32602, error.message);
      }
      return jsonRpcError(body, -32603, error instanceof Error ? error.message : "Internal error");
    }
  }

  return jsonRpcError(body, -32601, "Method not found");
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", () => jsonNoStore(discovery("all")));
app.post("/", (c) => handleMcpPost(c.req.raw, c.env, "all"));
app.get("/events", () => jsonNoStore(discovery("events")));
app.post("/events", (c) => handleMcpPost(c.req.raw, c.env, "events"));
app.post("/oauth/register", async (c) => {
  const body = (await c.req.raw.json().catch(() => ({}))) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];
  if (redirectUris.some((redirectUri) => !isAllowedLoopbackRedirectUri(redirectUri))) {
    return jsonNoStore(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be loopback callback URLs such as http://localhost:12345/callback",
      },
      400,
    );
  }
  const clientId = `pkic-mcp-${crypto.randomUUID()}`;
  return jsonNoStore(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
});
app.get("/oauth/authorize", (c) => Response.redirect(adminAuthorizeUrl(c.req.raw), 302));
app.post("/oauth/authorize/approve", async (c) => {
  try {
    return await handleAuthorizeApprove(c);
  } catch (error) {
    if (isAppError(error)) {
      return jsonNoStore({ error: error.code, error_description: error.message }, error.status);
    }
    return jsonNoStore({ error: "server_error" }, 500);
  }
});
app.post("/oauth/token", async (c) => {
  try {
    return await handleToken(c);
  } catch (error) {
    if (isAppError(error)) {
      return jsonNoStore({ error: error.code, error_description: error.message }, error.status);
    }
    return jsonNoStore({ error: "server_error" }, 500);
  }
});

export default app;
