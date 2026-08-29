import type { RateLimitBinding } from "./rate-limit";

export interface D1StatementResult<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes: number };
}

export interface StatementLike {
  bind(...values: unknown[]): StatementLike;
  run<T = Record<string, unknown>>(): Promise<D1StatementResult<T>>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
}

export interface DatabaseLike {
  prepare(query: string): StatementLike;
  batch(statements: StatementLike[]): Promise<D1StatementResult[]>;
  exec?(query: string): Promise<unknown>;
  withSession?(constraintOrBookmark?: string): DatabaseLike & { getBookmark?(): string | null };
}

export interface R2ObjectLike {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
  };
}

/**
 * Minimal shape of the Cloudflare Images binding (env.IMAGES).
 * Takes a raw stream (e.g. from R2), applies transformations, and produces
 * a resized/converted image — no public URL or HTTP round-trip required.
 */
export interface ImagesBinding {
  input(stream: ReadableStream): {
    transform(opts: { width?: number; height?: number; fit?: string }): {
      output(opts: { format: string; quality?: number }): Promise<{ response(): Response }>;
    };
  };
}

export interface StaticAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export type R2BucketLike = R2Bucket;

export interface Env {
  DB: DatabaseLike;
  /** Static assets binding served from the `public` directory in Workers mode. */
  ASSETS?: StaticAssetsBinding;
  /** Static assets binding used by local `wrangler dev` preview environments. */
  ASSETS_PUBLIC?: StaticAssetsBinding;
  /** Local static origin used by local dev when avoiding Wrangler assets mode. */
  DEV_STATIC_ORIGIN?: string;
  /** R2 bucket for general assets (OG badges, layout HTML, etc.). */
  ASSETS_BUCKET?: R2BucketLike;
  /** R2 bucket for speaker headshots and presentation uploads. */
  SPEAKER_UPLOADS_BUCKET?: R2BucketLike;
  /** Cloudflare Images binding — resize/convert images from raw streams without a public URL. */
  IMAGES?: ImagesBinding;
  /** Cloudflare Browser Rendering binding — headless Chromium for HTML-to-image rendering. */
  BROWSER?: Fetcher;
  /** Cloudflare Worker Loader binding for MCP codemode sandbox execution. */
  LOADER?: WorkerLoader;
  /** KV namespace used by the Workers OAuth Provider for MCP auth state and tokens. */
  OAUTH_KV?: KVNamespace;
  /** Cloudflare Rate Limiting binding for low-volume per-email public email triggers. */
  EMAIL_RATE_LIMITER?: RateLimitBinding;
  /** Cloudflare Rate Limiting binding for higher-volume per-IP public email triggers. */
  IP_RATE_LIMITER?: RateLimitBinding;
  /** Optional explicit origin for local dev or background jobs that lack a request URL. */
  APP_BASE_URL?: string;
  /** Comma-separated HTTPS hostnames permitted for remotely fetched event hero images. */
  HERO_IMAGE_ALLOWED_HOSTS?: string;
  DEFAULT_MIN_PROPOSAL_REVIEWS?: string;
  DEFAULT_REFERRAL_CODE_LENGTH?: string;
  DEFAULT_INVITE_LIMIT_PER_ATTENDEE?: string;
  DEFAULT_INVITE_LIMIT_SPEAKER_NOMINATION?: string;
  WAITLIST_CLAIM_WINDOW_HOURS?: string;
  MAGIC_LINK_TTL_MINUTES?: string;
  CONFIRMATION_LINK_TTL_HOURS?: string;
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS?: string;
  MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS?: string;
  REMINDER_INTERVAL_DAYS?: string;
  PENDING_CONFIRMATION_REMINDER_INTERVAL_DAYS?: string;
  MAX_INVITE_REMINDERS?: string;
  MAX_PENDING_CONFIRMATION_REMINDERS?: string;
  MAX_PRESENTATION_REMINDERS?: string;
  PRESENTATION_REMINDER_LEAD_DAYS?: string;
  SCHEDULED_REMINDER_LIMIT?: string;
  SCHEDULED_OUTBOX_LIMIT?: string;
  SCHEDULED_BADGE_RENDER_LIMIT?: string;
  SCHEDULED_STORAGE_DELETION_LIMIT?: string;
  SCHEDULED_WAITLIST_PROMOTION_LIMIT?: string;
  SCHEDULED_RSVP_ENFORCEMENT_LIMIT?: string;
  SCHEDULED_JOBS_PER_PASS?: string;
  SCHEDULED_DUE_WORK_MAX_PASSES?: string;
  SCHEDULED_DUE_WORK_MAX_MS?: string;
  /** Maximum D1 statements issued by one scheduled Worker invocation. */
  SCHEDULED_D1_QUERY_BUDGET?: string;
  SCHEDULED_CONSULTATION_BATCH_LIMIT?: string;
  SCHEDULED_ON_HOLD_REMINDER_LIMIT?: string;
  SCHEDULED_EC_AUTO_APPROVE_LIMIT?: string;
  SCHEDULED_GOOGLE_GROUPS_SYNC_LIMIT?: string;
  SCHEDULED_SPONSORSHIP_DUE_WORK_LIMIT?: string;
  SCHEDULED_VOTE_DUE_WORK_LIMIT?: string;
  SCHEDULED_VOTE_NOTIFICATION_LIMIT?: string;
  /** Maximum distinct recipients resolved for a synchronous event campaign. */
  EVENT_CAMPAIGN_MAX_RECIPIENTS?: string;
  CSV_EXPORT_MAX_ROWS?: string;
  CSV_EXPORT_MAX_BYTES?: string;
  APPLICATION_DOCUMENT_MAX_BYTES?: string;
  APPLICATION_DOCUMENT_MAX_COUNT?: string;
  APPLICATION_DOCUMENT_TOTAL_MAX_BYTES?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_API_BASE?: string;
  FROM_EMAIL?: string;
  FROM_NAME?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
  RSVP_EMAIL?: string;
  RSVP_INBOUND_EMAIL_MAX_BYTES?: string;
  INTERNAL_SIGNING_SECRET?: string;
  /** Secret used to encrypt protected external meeting-provider join URLs at rest. */
  MEETING_PROVIDER_ENCRYPTION_KEY?: string;
  /** ECDSA P-256 public key (base64) from SendGrid's Event Webhook settings. Used to verify signed webhook payloads. */
  SENDGRID_WEBHOOK_VERIFICATION_KEY?: string;
  FEEDBACK_IDENTITY_SECRET_V1?: string;
  /**
   * Static API key for headless/programmatic service access (stats collection, CI, etc.).
   * Set as a Cloudflare secret. When provided, a request bearing this value as
   * a Bearer token is granted admin privileges without a DB session lookup.
   */
  ADMIN_API_KEY?: string;
  /** Stripe secret key for creating Checkout Sessions (donation flow). */
  STRIPE_SECRET_KEY?: string;
  /** Stripe publishable key returned to the client for Embedded Checkout. */
  STRIPE_PUBLISHABLE_KEY?: string;
  /** Stripe webhook signing secret for verifying checkout.session.completed events. */
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * Seconds to delay sending the registration-confirmed email so the OG badge has
   * time to render and can be attached. Defaults to 90 in production. Set to 0 in
   * local dev / e2e to avoid artificial waits.
   */
  EMAIL_BADGE_DELAY_SECONDS?: string;
  /**
   * BCC address for donation thank-you emails. When set, every donor
   * thank-you email is BCC'd here so the team has an internal record.
   * Typically: contact@pkic.org
   */
  DONATION_NOTIFICATION_EMAIL?: string;
  /**
   * Recipient for the sponsorship-new-inquiry staff notification email.
   * Defaults to sponsorships@pkic.org when unset.
   */
  SPONSORSHIP_NOTIFICATION_EMAIL?: string;
  /** Configurable brochure PDF link attached to the sponsorship-brochure email. */
  SPONSORSHIP_BROCHURE_URL?: string;
  /** WebAuthn Relying Party ID (bare domain, e.g. "pkic.org"). */
  WEBAUTHN_RP_ID?: string;
  /** WebAuthn Relying Party display name shown in browser passkey prompts. */
  WEBAUTHN_RP_NAME?: string;
  /** WebAuthn expected origin (scheme + host, e.g. "https://pkic.org"). */
  WEBAUTHN_ORIGIN?: string;
  /** Member (non-admin) magic-link session TTL, hours. Defaults to 720 (30 days). */
  MEMBER_SESSION_TTL_HOURS?: string;
  /** Google Workspace service account email used to sign Directory API JWTs. */
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  /** Google Workspace service account PEM private key. */
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  /** Google Workspace admin user to impersonate via domain-wide delegation (Directory API requires this). */
  GOOGLE_WORKSPACE_ADMIN_EMAIL?: string;
}

export interface PagesContext<P extends Record<string, string> = Record<string, string>> {
  request: Request;
  env: Env;
  params: P;
  waitUntil(promise: Promise<unknown>): void;
  data?: Record<string, unknown>;
  next?: () => Promise<Response>;
  req?: {
    raw?: Request;
    param?: (name?: string) => string | P;
    parseBody?: () => Promise<Record<string, unknown>>;
  };
  executionCtx?: {
    waitUntil(promise: Promise<unknown>): void;
  };
  set?: (key: string, value: unknown) => void;
  get?: (key: string) => unknown;
  res?: Response;
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonArray = JsonValue[];

/**
 * A single contextual permission — e.g. "events:manage" scoped to
 * one event's UUID, or "groups:write" scoped to one group's UUID.
 * `contextType`/`contextId` are both null for a global (unscoped) grant.
 */
export interface PermissionGrant {
  permission: string;
  contextType: string | null;
  contextId: string | null;
}

/**
 * Resolved member capacity on the shared human session. Current-user resource
 * endpoints are identity-gated (a valid session backed by an active
 * `members` row), not `resource:action` permission-gated — the `member`/
 * `interested_parties` roles carry no `role_permissions` rows (see
 * functions/_lib/auth/user-session.ts).
 */
/**
 * One aggregate a user is eligible to act as: their own org-less individual
 * membership, or an organization they actively represent. A user can hold
 * more than one of these concurrently (multi-organization representation is
 * a supported product case — see functions/_lib/auth/user-session.ts).
 */
export interface EligibleMembership {
  memberId: string;
  organizationId: string | null;
  organizationName: string | null;
  membershipCategory: string;
}

export interface AuthMember {
  userId: string;
  email: string;
  memberId: string;
  organizationId: string | null;
  membershipCategory: string;
  isEcMember: boolean;
  /**
   * Every membership context this user is currently eligible to act
   * through, deterministically ordered (individual membership first, then
   * organizations by earliest joined_at) — memberId/organizationId above
   * are always exactly the first entry unless the caller explicitly
   * selected a different one (see selectActiveMembership in
   * functions/_lib/auth/user-session.ts). Always has at least one entry.
   */
  activeMemberships: EligibleMembership[];
  sessionId?: string;
  expiresAt?: string;
}

interface AuthAdminBase {
  /** Stable identity used in audit records and authorization decisions. */
  id: string;
  email: string;
  role: string;
  scopes?: string[];
  /** True only for an OAuth/MCP access token whose delegated scopes must cap runtime permissions. */
  scopeRestricted?: boolean;
  /**
   * Contextual permissions, resolved from `user_roles` +
   * `permission_grants` on every authenticated request (see
   * functions/_lib/auth/permissions.ts). Populated only for requests that
   * went through requireAdminFromRequest's session/API-key path.
   */
  grants?: PermissionGrant[];
}

/** A staff actor whose canonical id is also a real users(id) value. */
export interface UserBackedAuthAdmin extends AuthAdminBase {
  identityType: "user";
  sessionId?: string;
  expiresAt?: string;
  state?: string | null;
}

/** An authenticated non-user actor, such as the shared administrative API key. */
export interface ServiceAuthAdmin extends AuthAdminBase {
  identityType: "service";
}

/**
 * Authenticated staff is deliberately discriminated by identity provenance.
 * The single `id` is canonical: it is a users(id) only for the `user` branch,
 * and an audit identity only for the `service` branch.
 */
export type AuthAdmin = UserBackedAuthAdmin | ServiceAuthAdmin;
