import { uuid } from "../utils/ids";

export const DURABLE_JOB_LEASE_SECONDS = 5 * 60;

export interface DurableJobLease {
  token: string;
  claimedAt: string;
  expiresAt: string;
}

/**
 * Creates the ownership token shared by every D1-backed external-effect
 * worker. A later worker may reclaim an expired lease; token-guarded
 * finalization then prevents the former owner from overwriting that result.
 */
export function createDurableJobLease(now = new Date()): DurableJobLease {
  return {
    token: uuid(),
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DURABLE_JOB_LEASE_SECONDS * 1_000).toISOString(),
  };
}
