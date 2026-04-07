export interface StatementLike {
  bind(...values: unknown[]): StatementLike;
  run<T = Record<string, unknown>>(): Promise<{ success: boolean; results?: T[]; meta?: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
}

export interface DatabaseLike {
  prepare(query: string): StatementLike;
  batch(statements: StatementLike[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
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

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: Record<string, unknown>): Promise<void>;
}

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
  /** Optional explicit origin for local dev or background jobs that lack a request URL. */
  APP_BASE_URL?: string;
  DEFAULT_MIN_PROPOSAL_REVIEWS: string;
  DEFAULT_REFERRAL_CODE_LENGTH: string;
  DEFAULT_INVITE_LIMIT_PER_ATTENDEE: string;
  DEFAULT_INVITE_LIMIT_SPEAKER_NOMINATION?: string;
  WAITLIST_CLAIM_WINDOW_HOURS: string;
  MAGIC_LINK_TTL_MINUTES: string;
  MANAGE_TOKEN_TTL_HOURS: string;
  REMINDER_INTERVAL_DAYS?: string;
  MAX_INVITE_REMINDERS?: string;
  MAX_PRESENTATION_REMINDERS?: string;
  SCHEDULED_REMINDER_LIMIT?: string;
  SCHEDULED_OUTBOX_LIMIT?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_API_BASE: string;
  FROM_EMAIL?: string;
  FROM_NAME?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
  INTERNAL_SIGNING_SECRET?: string;
  FEEDBACK_IDENTITY_SECRET_V1?: string;
  /**
   * Static API key for headless/programmatic admin access (stats collection, CI, etc.).
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
    param?: (name: string) => string;
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

export interface AuthAdmin {
  id: string;
  email: string;
  role: string;
}
