import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../../functions/router";
import type { Env } from "../../functions/_lib/types";

export async function callApi(environment: Env, path: string | Request, init?: RequestInit): Promise<Response> {
  const request = typeof path === "string" ? new Request(new URL(path, "https://app.test"), init) : path;
  const executionContext = createExecutionContext();
  try {
    return await app.fetch(request, environment, executionContext);
  } finally {
    await waitOnExecutionContext(executionContext);
  }
}
