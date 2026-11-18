/**
 * The live production sections of the design preview: the event screens, the
 * studio and its outputs, the event app's answer threads, and the stage
 * display. They load as their own chunk, after the shell, since they carry
 * the whole live room.
 */
import type { PreviewSection } from "./PreviewShell";
import { eventScreenSections } from "./sections-event-screens";
import { eventScreenStaffSections } from "./sections-event-screens-staff";
import { eventScreenMonitorSections } from "./sections-event-screens-monitor";
import { studioOnScreenSections } from "./sections-studio-on-screen";
import { studioBoardSections } from "./sections-studio-board";
import { studioQuestionSections } from "./sections-studio-questions";
import { studioTimerSections } from "./sections-studio-timers";
import { liveAnswerSections } from "./sections-live-answers";
import { eventScreenBrowserSections } from "./sections-event-screens-browser";
import { stageDisplaySections } from "./sections-stage-display";
import { liveReactionsSections } from "./sections-live-reactions";
import { roomScreensSections } from "./sections-room-screens";

export const liveProductionSections: PreviewSection[] = [
  ...eventScreenSections,
  ...eventScreenStaffSections,
  ...eventScreenMonitorSections,
  ...studioOnScreenSections,
  ...roomScreensSections,
  ...studioBoardSections,
  ...studioQuestionSections,
  ...studioTimerSections,
  ...liveAnswerSections,
  ...eventScreenBrowserSections,
  ...stageDisplaySections,
  ...liveReactionsSections,
];
