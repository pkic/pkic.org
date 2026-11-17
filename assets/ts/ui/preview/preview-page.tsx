/**
 * Entry point for the design-system preview at /design/.
 *
 * Self-executing, following the loader convention: importing the module is
 * enough to mount it. The page is unlisted and noindex — it exists to see and
 * tune the primitives, and to check each surface as it comes off Bootstrap.
 */

import { render } from "preact";

import { PreviewShell, type PreviewSection } from "./PreviewShell";
import { badgeLabelDeskSection } from "./badge-label-desk";
import { scannerPresentationSection, scannerDestinationsSection } from "./scanner-presentation";
import { badgePrintingSection } from "./badge-printing";
import { registrationRosterActionsSection } from "./registration-roster-actions";
import { basicSections } from "./sections-basics";
import { dataSections } from "./sections-data";
import { densitySections } from "./sections-density";
import { overlaySections } from "./sections-overlays";
import { patternSections } from "./sections-patterns";
import { agendaPickerSections } from "./sections-agenda-picker";
import { eventParticipationSections } from "./sections-event-participation";
import { speakerProfileReviewSections } from "./sections-speaker-profile-review";
import { eventScreenSections } from "./sections-event-screens";
import { eventScreenStaffSections } from "./sections-event-screens-staff";
import { eventScreenMonitorSections } from "./sections-event-screens-monitor";
import { eventScreenBrowserSections } from "./sections-event-screens-browser";

async function main(): Promise<void> {
  const mount = document.getElementById("pk-preview");
  if (!mount) return;
  // If the live-room chunk fails to load, the rest of the gallery still renders, with a note in its place.
  const live = await import("./sections-live-room").catch(() => null);
  const unloaded: PreviewSection[] = [
    {
      id: "live-room-unavailable",
      title: "Live-room sections",
      note: "These sections did not load. Reload the page to try again.",
      render: () => null,
    },
  ];
  const liveAnswerSections = live?.liveAnswerSections ?? unloaded;
  const liveReactionsSections = live?.liveReactionsSections ?? [];
  const stageDisplaySections = live?.stageDisplaySections ?? [];
  const studioOnScreenSections = live?.studioOnScreenSections ?? [];
  const studioTimerSections = live?.studioTimerSections ?? [];
  const sections = [
    ...basicSections,
    ...dataSections,
    ...densitySections,
    ...overlaySections,
    ...patternSections,
    ...agendaPickerSections,
    ...speakerProfileReviewSections,
    ...eventParticipationSections,
    badgePrintingSection,
    registrationRosterActionsSection,
    badgeLabelDeskSection,
    scannerPresentationSection,
    scannerDestinationsSection,
    ...eventScreenSections,
    ...eventScreenStaffSections,
    ...eventScreenMonitorSections,
    ...studioOnScreenSections,
    ...studioTimerSections,
    ...liveAnswerSections,
    ...eventScreenBrowserSections,
    ...stageDisplaySections,
    ...liveReactionsSections,
  ];
  // `?only=<id>` renders one section alone, for a tight screenshot of one control.
  const only = new URLSearchParams(window.location.search).get("only");
  const shown = only ? sections.filter((section) => section.id === only) : sections;
  render(<PreviewShell sections={shown} />, mount);
}

void main();
