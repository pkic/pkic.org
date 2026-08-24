import type { EventProviderType } from "../../../../assets/shared/schemas/event-series";

/**
 * Provider-neutral boundary for future managed meeting integrations. Provider
 * SDK objects and credentials must remain behind this interface; the event,
 * occurrence, access, terms, and attendance models stay canonical in D1.
 */
export interface ManagedMeetingProviderOccurrence {
  seriesId: string;
  occurrenceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface ManagedMeetingProviderResult {
  externalId: string;
  joinUrl: string;
  providerData: Record<string, unknown>;
}

export interface ManagedMeetingAttendanceEvidence {
  externalParticipantId: string;
  email: string | null;
  joinedAt: string;
  leftAt: string | null;
}

export interface ManagedMeetingProvider {
  readonly type: Exclude<EventProviderType, "external_url">;
  createOrUpdateOccurrence(input: ManagedMeetingProviderOccurrence): Promise<ManagedMeetingProviderResult>;
  cancelOccurrence(externalId: string): Promise<void>;
  listAttendanceEvidence(externalId: string): Promise<ManagedMeetingAttendanceEvidence[]>;
}
