import { z } from "zod";
import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { liveOverlayLayoutGeometriesSchema } from "../../../../assets/shared/schemas/live-overlay-layout";
import {
  liveTickerContextSchema,
  DEFAULT_LIVE_TICKER_CONTEXT,
} from "../../../../assets/shared/schemas/live-session-ticker";
import { liveStudioGraphicsSetupSchema } from "../../../../assets/shared/schemas/live-studio-setup";
import { parseJsonSafe } from "../../utils/json";
import type { LiveRoomSql } from "./room-sql";

const basisSchema = z.object({
  layouts: liveOverlayLayoutGeometriesSchema,
  context: liveTickerContextSchema,
  agenda: storedAgendaSnapshotSchema.nullable(),
  /** The event's saved graphics setup: the look a graphic a scene brings on starts from. A basis saved before it reads as none. */
  graphics: liveStudioGraphicsSetupSchema.default({}),
});
type Basis = z.infer<typeof basisSchema>;
type BasisInput = z.input<typeof basisSchema>;

/** Public graphic inputs refresh off the control path and survive room hibernation. */
export class LiveRoomGraphicBasis {
  private current: Basis | undefined;
  ready = false;
  constructor(private readonly sql: LiveRoomSql) {}

  /**
   * The saved basis. One that no longer reads, such as one that still holds
   * a built-in scene retired since, reads as none, so the room reads it
   * again from the event instead of failing.
   */
  read(): Basis {
    if (this.current) return this.current;
    const [row] = this.sql.rows<{ value_json: string }>(
      "SELECT value_json FROM room_controls WHERE name='graphicBasis'",
    );
    const saved = row ? basisSchema.safeParse(parseJsonSafe<unknown>(row.value_json, null)) : null;
    this.ready = saved?.success === true;
    return (this.current = saved?.success
      ? saved.data
      : {
          layouts: [],
          context: DEFAULT_LIVE_TICKER_CONTEXT,
          agenda: null,
          graphics: {},
        });
  }

  save(value: BasisInput): void {
    const parsed = basisSchema.parse(value);
    this.sql.exec(
      "INSERT INTO room_controls(name,value_json) VALUES('graphicBasis',?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json",
      JSON.stringify(parsed),
    );
    this.current = parsed;
    this.ready = true;
  }
}
