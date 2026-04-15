declare module "cloudflare:test" {
  export const env: Env & { ADMIN_API_KEY?: string };
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  export function applyD1Migrations(db: D1Database, migrationsPath?: string): Promise<void>;
}
