/**
 * The gallery's live-room sections: the studio's on-screen lists and timers,
 * the event app's answer threads, and the stage display. They carry the live
 * room's components, so the gallery loads them as their own chunk after the
 * shell.
 */
import { liveAnswerSections } from "./sections-live-answers";
import { stageDisplaySections } from "./sections-stage-display";
import { studioOnScreenSections } from "./sections-studio-on-screen";
import { studioTimerSections } from "./sections-studio-timers";

export { liveAnswerSections, stageDisplaySections, studioOnScreenSections, studioTimerSections };
