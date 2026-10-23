import { z } from "zod";
import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { liveOverlayLayoutGeometriesSchema } from "../../../../assets/shared/schemas/live-overlay-layout";
import {
  liveTickerContextSchema,
  DEFAULT_LIVE_TICKER_CONTEXT,
} from "../../../../assets/shared/schemas/live-session-ticker";
import type { LiveRoomSql } from "./room-sql";

const basisSchema = z.object({
  layouts: liveOverlayLayoutGeometriesSchema,
  context: liveTickerContextSchema,
  agenda: storedAgendaSnapshotSchema.nullable(),
});
type Basis = z.infer<typeof basisSchema>;

/** Public graphic inputs refresh off the control path and survive room hibernation. */
export class LiveRoomGraphicBasis {
  private current: Basis | undefined;
  ready = false;
  constructor(private readonly sql: LiveRoomSql) {}

  read(): Basis {
    if (this.current) return this.current;
    const [row] = this.sql.rows<{ value_json: string }>(
      "SELECT value_json FROM room_controls WHERE name='graphicBasis'",
    );
    this.ready = row !== undefined;
    return (this.current = row
      ? basisSchema.parse(JSON.parse(row.value_json))
      : {
          layouts: [],
          context: DEFAULT_LIVE_TICKER_CONTEXT,
          agenda: null,
        });
  }

  save(value: Basis): void {
    const parsed = basisSchema.parse(value);
    this.sql.exec(
      "INSERT INTO room_controls(name,value_json) VALUES('graphicBasis',?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json",
      JSON.stringify(parsed),
    );
    this.current = parsed;
    this.ready = true;
  }
}
