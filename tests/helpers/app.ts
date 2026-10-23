// Prepare the real HTTP graph before timed API journeys; the Worker entry imports it lazily.
import "../../functions/http-router";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../../functions/router";
import { enforceD1RoundTripBudget, type D1RoundTripBudget } from "./d1-round-trip-budget";
import { profileD1Flow } from "./d1-flow-profile";
import type { Env } from "../../functions/_lib/types";

export default app;

export async function callApi(
  environment: Env,
  path: string | Request,
  init?: RequestInit,
  budget?: D1RoundTripBudget,
): Promise<Response> {
  // Advisory audit applies to every mounted callApi request; individual converted workflows opt into a strict budget.
  const mode = process.env.PKIC_D1_BUDGET_MODE;
  const policy = budget ?? (mode === "warn" || mode === "fail" ? { maxRoundTrips: 1, mode } : undefined);
  // Preserve zero-D1 routes: merely enabling measurement must not access the binding.
  const measurement: { profile: ReturnType<typeof profileD1Flow> | null } = { profile: null };
  const measuredEnvironment = policy
    ? new Proxy(environment, {
        get(target, property, receiver) {
          if (property !== "DB") return Reflect.get(target, property, receiver);
          measurement.profile ??= profileD1Flow(Reflect.get(target, property, receiver));
          return measurement.profile.db;
        },
      })
    : environment;
  const request = typeof path === "string" ? new Request(new URL(path, "https://app.test"), init) : path;
  const executionContext = createExecutionContext();
  try {
    return await app.fetch(request, measuredEnvironment, executionContext);
  } finally {
    await waitOnExecutionContext(executionContext);
    if (policy)
      enforceD1RoundTripBudget(
        measurement.profile?.summary() ?? { roundTrips: 0, statements: 0, queries: [] },
        policy,
        `${request.method} ${new URL(request.url).pathname}`,
      );
  }
}
