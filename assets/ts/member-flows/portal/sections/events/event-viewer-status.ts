/**
 * Where the viewer stands at an event, as the one status line an event card
 * and an events list row both show: "You're registered (in person) · 2
 * proposals (accepted) · Speaker".
 *
 * Expected states are plain text. Only a state that changes what the viewer
 * does next is flagged with a tone: a registration still to confirm, a wait
 * for a seat, a speaker invitation to answer, a proposal that needs work or
 * was turned down.
 */
import type { EventParticipation } from "../../../../../shared/schemas/event-participation";
import type { EventViewerState } from "../../../../../shared/schemas/event-management";
import { formatNumber } from "../../../../../shared/format-number";
import { statusLabel, statusTone } from "../../../../../shared/status-display";
import { attendanceStandingParts } from "../../../../shared/viewer-attendance";
import type { CollectionStatus } from "../../../../ui/CollectionCard";

interface EventStanding {
  participation?: EventParticipation;
  viewer?: EventViewerState | null;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function count(value: number, noun: string): string {
  return `${formatNumber(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function registrationStatus({ participation, viewer }: EventStanding): CollectionStatus[] {
  const status = viewer?.registrationStatus ?? participation?.registrationStatus ?? null;
  if (status === "pending_email_confirmation") return [{ label: "Confirm your registration", tone: "warn" }];
  if (status === "cancelled") return [{ label: "Registration cancelled", tone: "neutral" }];
  if (status !== "registered") return [];
  if (!viewer) return [{ label: "You're registered" }];
  const parts = attendanceStandingParts(viewer);
  const waiting = parts.filter((part) => part.startsWith("Waitlisted"));
  const holding = parts.filter((part) => !part.startsWith("Waitlisted"));
  const items: CollectionStatus[] = [];
  items.push({
    label: holding.length > 0 ? `You're registered (${holding.map(lowerFirst).join(", ")})` : "You're registered",
  });
  // A wait for a seat changes what the viewer plans for, so each one is flagged.
  for (const part of waiting) items.push({ label: part, tone: "info" });
  if (viewer.waitlisted && waiting.length === 0) items.push({ label: "Waitlisted", tone: "info" });
  return items;
}

/** "2 proposals (accepted)", plus a flag for any proposal that needs the viewer or was turned down. */
function proposalStatus(participation: EventParticipation | undefined): CollectionStatus[] {
  const total = Math.max(participation?.proposals ?? 0, participation?.proposalStates.length ?? 0);
  if (!participation || total === 0) return [];
  const states = [...new Set(participation.proposalStates)];
  const expected = states.filter((state) => !["warn", "danger"].includes(statusTone(state)));
  const flagged = states.filter((state) => ["warn", "danger"].includes(statusTone(state)));
  const detail = expected.map((state) => statusLabel(state).toLowerCase()).join(", ");
  return [
    { label: detail ? `${count(total, "proposal")} (${detail})` : count(total, "proposal") },
    ...flagged.map((state): CollectionStatus => ({
      label: `Proposal ${statusLabel(state).toLowerCase()}`,
      tone: statusTone(state) === "danger" ? "danger" : "warn",
    })),
  ];
}

/** "Speaker", or "Speaker on 2 proposals"; an invitation still to answer is flagged. */
function speakerStatus(participation: EventParticipation | undefined): CollectionStatus[] {
  if (!participation) return [];
  const states = new Set(participation.speakerStates);
  if (participation.speakerProposals === 0 && states.size === 0) return [];
  const items: CollectionStatus[] = [];
  if (states.has("confirmed") || states.size === 0)
    items.push({
      label:
        participation.speakerProposals > 1
          ? `Speaker on ${count(participation.speakerProposals, "proposal")}`
          : "Speaker",
    });
  if (states.has("invited")) items.push({ label: "Answer speaker invitation", tone: "warn" });
  if (states.has("pending") && !states.has("confirmed")) items.push({ label: "Speaker (pending)" });
  if (states.has("declined") && !states.has("confirmed")) items.push({ label: "Declined to speak" });
  return items;
}

export function eventViewerStatus(event: EventStanding): CollectionStatus[] {
  return [...registrationStatus(event), ...proposalStatus(event.participation), ...speakerStatus(event.participation)];
}
