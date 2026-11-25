import { z } from "zod";
import {
  STUDIO_MAX_PANELS,
  studioPanelSchema,
  type StudioPanel,
  type StudioPanelType,
} from "../../../../../../../../shared/schemas/live-studio-layout";

/** The phone's own panels, apart from the desk's arrangement, in this browser. */
export const STUDIO_PHONE_PANELS_STORAGE_KEY = "pkic.live-studio.phone.v1";
const studioPhonePanelsSchema = z.array(studioPanelSchema).max(STUDIO_MAX_PANELS);

/**
 * One panel as a phone shows it: a whole view, so its place and size on the
 * desk's grid never matter. The bar above the views already shows Preview and
 * Program, so the monitor starts on the room's screens: the projector and the
 * speaker's display, or every screen of a room that has other ones.
 */
export const studioPhonePanel = (type: StudioPanelType): StudioPanel => ({
  id: `phone-${type}`,
  type,
  x: 0,
  y: 0,
  w: 12,
  h: 8,
  ...(type === "monitor" ? { outputs: ["projector", "stage-display"] } : {}),
});

/** The phone's panels as this browser saved them; a type with nothing saved, or saved unreadably, starts over. */
export function loadStudioPhonePanels(
  storage: Pick<Storage, "getItem"> | null,
  types: readonly StudioPanelType[],
): StudioPanel[] {
  let saved: StudioPanel[] = [];
  try {
    const raw = storage?.getItem(STUDIO_PHONE_PANELS_STORAGE_KEY);
    const parsed = studioPhonePanelsSchema.safeParse(raw ? JSON.parse(raw) : undefined);
    if (parsed.success) saved = parsed.data;
  } catch {
    // Storage can be blocked or hold something else; the defaults still work.
  }
  return types.map((type) => saved.find((panel) => panel.type === type) ?? studioPhonePanel(type));
}

export function saveStudioPhonePanels(storage: Pick<Storage, "setItem"> | null, panels: readonly StudioPanel[]): void {
  try {
    storage?.setItem(STUDIO_PHONE_PANELS_STORAGE_KEY, JSON.stringify(panels));
  } catch {
    // A full or blocked storage keeps the choices for this visit only.
  }
}
