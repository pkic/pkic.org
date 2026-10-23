import { expect } from "vitest";
import type { profileD1Flow } from "./d1-flow-profile";

export interface D1RoundTripBudget {
  maxRoundTrips: number;
  mode?: "warn" | "fail";
}

/** Count binding round trips, including sessions and failed/parallel calls; never include bound parameter values. */
export function enforceD1RoundTripBudget(
  measured: ReturnType<ReturnType<typeof profileD1Flow>["summary"]>,
  budget: D1RoundTripBudget,
  label: string,
): void {
  if (!Number.isSafeInteger(budget.maxRoundTrips) || budget.maxRoundTrips < 0)
    throw new Error("D1 round-trip budget must be a nonnegative integer");
  if (measured.roundTrips <= budget.maxRoundTrips) return;
  const message =
    `${label}: D1 round-trip budget exceeded (${measured.roundTrips} > ${budget.maxRoundTrips}); ${measured.statements} SQL statements.\n` +
    measured.queries.map((query, index) => `${index + 1}. ${query.operation}: ${query.sql}`).join("\n");
  if (budget.mode === "warn") console.warn(message);
  else expect(measured.roundTrips, message).toBeLessThanOrEqual(budget.maxRoundTrips);
}
