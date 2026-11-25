import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { StudioPanel, StudioWorkspace } from "../../../../../../../shared/schemas/live-studio-layout";
import {
  EMPTY_LIVE_STUDIO_SETUP,
  eventLiveStudioSetupResponseSchema,
  type EventLiveStudioSetupResponse,
  type LiveStudioGraphic,
  type LiveStudioGraphicsSetup,
  type LiveStudioSetup,
} from "../../../../../../../shared/schemas/live-studio-setup";
import { ApiClientError, getJson, putJson } from "../../../../../../shared/api-client";

/** What the studio says when the event's setup could not be saved. */
export const LIVE_STUDIO_SETUP_NOT_SAVED = "The studio setup was not saved. Check your connection and try again.";

/**
 * The event's studio setup as this studio has it: what each graphic starts
 * from when it goes on air, and the arrangement each workspace starts from.
 * Only someone who sets up the live studio saves it; for everyone else it is
 * read only.
 */
export interface LiveStudioSetupHandle {
  graphics: LiveStudioGraphicsSetup;
  layouts: LiveStudioSetup["layouts"];
  /** Whether this operator saves the event's setup; without it their changes apply to this show only. */
  canSave: boolean;
  /** Saves how one graphic starts for the whole event; the problem to show, or null once saved. */
  saveGraphic: <Graphic extends LiveStudioGraphic>(
    graphic: Graphic,
    settings: NonNullable<LiveStudioGraphicsSetup[Graphic]>,
  ) => Promise<string | null>;
  /** Saves a workspace's arrangement as the one every new studio starts from; the problem to show, or null. */
  saveLayout: (workspace: StudioWorkspace, panels: StudioPanel[]) => Promise<string | null>;
}

type Change = (setup: LiveStudioSetup) => LiveStudioSetup;

/**
 * Loads the event's setup once and saves one part at a time over the latest
 * version this studio read. When someone else saved in the meantime it reads
 * their version and applies this change to it once more, so two people
 * preparing different graphics never undo each other.
 */
export function useLiveStudioSetup(slug: string, canSave: boolean): LiveStudioSetupHandle {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/settings/live/studio`;
  const [current, setCurrent] = useState<EventLiveStudioSetupResponse>({ ...EMPTY_LIVE_STUDIO_SETUP, updatedAt: null });
  const latest = useRef(current);
  latest.current = current;
  const load = useCallback(async () => {
    const read = await getJson(endpoint, eventLiveStudioSetupResponseSchema);
    latest.current = read;
    setCurrent(read);
    return read;
  }, [endpoint]);
  useEffect(() => {
    // A studio that cannot read the setup still works from the built-in one.
    load().catch(() => undefined);
  }, [load]);
  const save = useCallback(
    async (change: Change): Promise<string | null> => {
      const put = async (base: EventLiveStudioSetupResponse) => {
        const { updatedAt, ...setup } = base;
        const saved = await putJson(
          endpoint,
          { ...change(setup), expectedUpdatedAt: updatedAt },
          eventLiveStudioSetupResponseSchema,
        );
        latest.current = saved;
        setCurrent(saved);
      };
      try {
        try {
          await put(latest.current);
        } catch (cause) {
          if (!(cause instanceof ApiClientError) || cause.status !== 409) throw cause;
          await put(await load());
        }
        return null;
      } catch (cause) {
        return cause instanceof ApiClientError && cause.status !== 0 ? cause.message : LIVE_STUDIO_SETUP_NOT_SAVED;
      }
    },
    [endpoint, load],
  );
  const saveGraphic = useCallback<LiveStudioSetupHandle["saveGraphic"]>(
    (graphic, settings) => save((setup) => ({ ...setup, graphics: { ...setup.graphics, [graphic]: settings } })),
    [save],
  );
  const saveLayout = useCallback<LiveStudioSetupHandle["saveLayout"]>(
    (workspace, panels) => save((setup) => ({ ...setup, layouts: { ...setup.layouts, [workspace]: panels } })),
    [save],
  );
  return { graphics: current.graphics, layouts: current.layouts, canSave, saveGraphic, saveLayout };
}
