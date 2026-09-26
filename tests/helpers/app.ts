import { createExecutionContext } from "cloudflare:test";
import app from "../../functions/router";
import type { Env } from "../../functions/_lib/types";

export function callApi(environment: Env, path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(new URL(path, "https://app.test"), init), environment, createExecutionContext());
}
