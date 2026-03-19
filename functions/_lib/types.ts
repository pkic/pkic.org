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

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: Record<string, unknown>): Promise<void>;
}

export interface Env {
  DB: DatabaseLike;
  /** R2 bucket for general assets (OG badges, layout HTML, etc.). */
  ASSETS_BUCKET?: R2BucketLike;
  /** R2 bucket for speaker headshots and presentation uploads. */
  SPEAKER_UPLOADS_BUCKET?: R2BucketLike;
  /** Cloudflare Images binding — resize/convert images from raw streams without a public URL. */
  IMAGES?: ImagesBinding;
  /** Cloudflare Pages deployment URL (for example https://branch.project.pages.dev). */
  CF_PAGES_URL?: string;
  /** Set in .dev.vars for local development; takes precedence over CF_PAGES_URL. */
  APP_BASE_URL?: string;
  DEFAULT_MIN_PROPOSAL_REVIEWS: string;
  DEFAULT_REFERRAL_CODE_LENGTH: string;
  DEFAULT_INVITE_LIMIT_PER_ATTENDEE: string;
  WAITLIST_CLAIM_WINDOW_HOURS: string;
  MAGIC_LINK_TTL_MINUTES: string;
  MANAGE_TOKEN_TTL_HOURS: string;
  REMINDER_INTERVAL_DAYS?: string;
  MAX_INVITE_REMINDERS?: string;
  MAX_PRESENTATION_REMINDERS?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_API_BASE: string;
  FROM_EMAIL?: string;
  FROM_NAME?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_FROM_NAME?: string;
  EMAIL_LAYOUT_R2_KEY?: string;
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
