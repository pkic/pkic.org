const ONE_DAY_MS = 86_400_000;

export type SponsorshipRenewalAction = "reminder-60" | "reminder-30" | "auto-lapse";

export interface SponsorshipRenewalState {
  pipelineStage: string;
  renewalDate: string | null;
  assignedToUserId: string | null;
}

function asUtcDate(value: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const instant = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === date ? date : null;
}

function addUtcDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * ONE_DAY_MS).toISOString().slice(0, 10);
}

function utcDaysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / ONE_DAY_MS);
}

export function utcDate(instant = new Date()): string {
  return instant.toISOString().slice(0, 10);
}

export function hasFutureRenewalDate(renewalDate: string | null, today: string): boolean {
  const normalizedRenewalDate = asUtcDate(renewalDate);
  const normalizedToday = asUtcDate(today);
  return Boolean(normalizedRenewalDate && normalizedToday && normalizedRenewalDate > normalizedToday);
}

/**
 * Materializes the first date on which the renewal scheduler must inspect an
 * active sponsorship. Unassigned sponsorships wait until expiry because
 * reminder emails have no recipient; they still auto-lapse on time.
 */
export function initialRenewalActionDueAt(state: SponsorshipRenewalState): string | null {
  const renewalDate = asUtcDate(state.renewalDate);
  if (state.pipelineStage !== "active" || !renewalDate) return null;
  return state.assignedToUserId ? addUtcDays(renewalDate, -60) : renewalDate;
}

export type ResolvedSponsorshipRenewalAction =
  | { action: "reminder-60"; effectKey: string; nextActionDueAt: string }
  | { action: "reminder-30"; effectKey: string; nextActionDueAt: string }
  | { action: "auto-lapse"; effectKey: string; nextActionDueAt: null };

/** Resolves exactly one action for a due queue row using UTC calendar days. */
export function resolveRenewalAction(
  state: SponsorshipRenewalState,
  today: string,
): ResolvedSponsorshipRenewalAction | null {
  const renewalDate = asUtcDate(state.renewalDate);
  const normalizedToday = asUtcDate(today);
  if (state.pipelineStage !== "active" || !renewalDate || !normalizedToday) return null;

  const daysRemaining = utcDaysBetween(normalizedToday, renewalDate);
  if (daysRemaining <= 0) {
    return { action: "auto-lapse", effectKey: `auto-lapse:${renewalDate}`, nextActionDueAt: null };
  }
  if (!state.assignedToUserId) return null;
  if (daysRemaining <= 30) {
    return {
      action: "reminder-30",
      effectKey: `renewal-reminder-30:${renewalDate}`,
      nextActionDueAt: renewalDate,
    };
  }
  if (daysRemaining <= 60) {
    return {
      action: "reminder-60",
      effectKey: `renewal-reminder-60:${renewalDate}`,
      nextActionDueAt: addUtcDays(renewalDate, -30),
    };
  }
  return null;
}
