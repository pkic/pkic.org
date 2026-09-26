import { signal } from "@preact/signals";
import type { EventDetail } from "./types";

/** The currently loaded event, shared only by the lazy event workspace. */
export const currentEvent = signal<EventDetail | null>(null);
