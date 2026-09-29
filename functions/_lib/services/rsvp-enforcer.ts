import { getConfig } from "../config";
import { logError, logInfo } from "../logging";
import type { DatabaseLike, Env } from "../types";
import {
  RSVP_ENFORCEMENT_D1_SAFETY_MARGIN,
  RSVP_ENFORCEMENT_MAX_ACTION_STATEMENTS,
  RSVP_ENFORCEMENT_SELECTION_STATEMENTS,
} from "../../../assets/shared/constants/rsvp-enforcement";
import { listDueRsvpEnforcementCandidates, type RsvpEnforcementCandidate } from "./rsvp-enforcement/candidates";
import { buildRsvpDayAction, commitRsvpDayAction } from "./rsvp-enforcement/day-action";
import { ignoreRsvpCandidate, recordRsvpDeliveryBounce, sendRsvpWarning } from "./rsvp-enforcement/signals";

export interface RsvpEnforcementResult {
  bouncesProcessed: number;
  warningsSent: number;
  downgradesProcessed: number;
  ignored: number;
  examined: number;
  limitReached: boolean;
}

function ignoredReason(
  candidate: RsvpEnforcementCandidate,
): "ignored_newer_accept" | "ignored_unresolved_day" | "ignored_no_longer_in_person" | null {
  if (!candidate.event_day_id || !candidate.day_starts_at) return "ignored_unresolved_day";
  if (candidate.has_newer_accept === 1) return "ignored_newer_accept";
  if (candidate.current_attendance_type !== "in_person") return "ignored_no_longer_in_person";
  return null;
}

export async function runRsvpEnforcer(
  db: DatabaseLike,
  env: Env,
  remainingD1Statements?: number,
): Promise<RsvpEnforcementResult> {
  const config = getConfig(env);
  const availableStatements = remainingD1Statements ?? config.scheduledD1QueryBudget;
  const budgetLimit = Math.max(
    0,
    Math.floor(
      (availableStatements - RSVP_ENFORCEMENT_D1_SAFETY_MARGIN - RSVP_ENFORCEMENT_SELECTION_STATEMENTS) /
        RSVP_ENFORCEMENT_MAX_ACTION_STATEMENTS,
    ),
  );
  const limit = Math.min(config.scheduledRsvpEnforcementLimit, budgetLimit);
  const result: RsvpEnforcementResult = {
    bouncesProcessed: 0,
    warningsSent: 0,
    downgradesProcessed: 0,
    ignored: 0,
    examined: 0,
    limitReached: false,
  };
  logInfo("RSVP_ENFORCER_STARTED", { limit });

  if (limit === 0) return result;

  try {
    const candidates = await listDueRsvpEnforcementCandidates(db, limit);
    result.examined = candidates.length;
    result.limitReached = candidates.length === limit && limit > 0;

    for (const candidate of candidates) {
      if (candidate.response_status === "bounced") {
        if (await recordRsvpDeliveryBounce(db, candidate)) result.bouncesProcessed += 1;
        continue;
      }

      const ignore = ignoredReason(candidate);
      if (ignore) {
        if (await ignoreRsvpCandidate(db, candidate, ignore)) result.ignored += 1;
        continue;
      }

      if (!candidate.warning_sent_at) {
        if (await sendRsvpWarning(db, env, candidate)) result.warningsSent += 1;
        continue;
      }

      const action = await buildRsvpDayAction(db, candidate);
      if (!(await commitRsvpDayAction(db, action.statements))) continue;
      result.downgradesProcessed += 1;
    }

    logInfo("RSVP_ENFORCER_COMPLETED", result);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError("RSVP_ENFORCER_FAILED", { error: errorMessage, ...result });
    throw error;
  }
}
