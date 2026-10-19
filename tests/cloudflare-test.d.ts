declare module "cloudflare:test" {
  export const env: Env & { ADMIN_API_KEY?: string };
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  export function waitOnExecutionContext(context: ExecutionContext): Promise<void>;
  export function createExecutionContext(): ExecutionContext;
  export function applyD1Migrations(db: D1Database, migrationsPath?: string): Promise<void>;
  /** Runs the object's scheduled alarm now; false when none was scheduled. */
  export function runDurableObjectAlarm(stub: DurableObjectStub): Promise<boolean>;
  export function runInDurableObject<R>(
    stub: DurableObjectStub,
    callback: (instance: unknown, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}
