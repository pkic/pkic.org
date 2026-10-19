import type { LiveCheckInText } from "../../../../assets/shared/schemas/live-session-graphic-settings";
import { resolveUpcomingRooms } from "../../../../assets/shared/live-session-schedule";
import type { LiveScheduleConfig } from "../../../../assets/shared/schemas/live-session-schedule";
import { readPublishedLiveAgenda } from "./approved-agenda";
import {
  DEFAULT_LIVE_TICKER_CONTEXT,
  type LiveTickerContext,
} from "../../../../assets/shared/schemas/live-session-ticker";
import { readLiveTickerContext } from "./room-ticker-context";
import type {
  LiveTickerConfig,
  LiveRoomSession,
  LiveRoomClientMessage,
  LiveCompositionInput,
  LiveStage,
} from "../../../../assets/shared/schemas/live-session-room";
import { LIVE_AUX_OUTPUTS } from "../../../../assets/shared/live-room-outputs";
import type { LiveRoomControls, LiveControlOutcome } from "./room-controls";
import type { LiveRoomOutputs } from "./room-outputs";
import type { LiveRoomPreview } from "./room-preview";
import { mergeLivePreview } from "../../../../assets/shared/live-room-preview";
import type { ResolvedComposition } from "./room-composition";
import type { LiveOverlayLayoutGeometry } from "../../../../assets/shared/schemas/live-overlay-layout";
import type { DatabaseLike } from "../../types";
import type { LiveRoomStore } from "./room-store";
import type { LiveRoomBroadcast } from "./room-broadcast";
import { readLiveOverlayLayoutGeometries } from "./overlay-layouts";
import { resolveLiveTicker } from "./room-ticker";
import { resolveLiveCheckIn } from "../event-attendance-points/live-check-in";
import type { AttendancePointSelection } from "../../../../assets/shared/attendance-points";
import type { LiveGraphicTheme } from "../../../../assets/shared/live-graphic-theme";

/** A check-in code the room cannot show: its day, room or session is gone, or codes are unavailable. */
const CHECK_IN_UNAVAILABLE = {
  code: "LIVE_CHECK_IN_UNAVAILABLE",
  message: "That check-in code is no longer available. Choose another one.",
};

type Actor = { userId: string; name: string };

/** Event geometry and computed ticker text refresh together; neither replaces the persisted source config. */
export class LiveRoomGraphics {
  layouts: LiveOverlayLayoutGeometry[] = [];
  tickerContext: LiveTickerContext = DEFAULT_LIVE_TICKER_CONTEXT;
  /** The attendee chat lines a chat ticker may show now. */
  chatTicker: () => string[] = () => [];
  constructor(
    /** The database, and the secret that signs check-in codes; without it no output can show one. */
    private readonly env: { DB: DatabaseLike; INTERNAL_SIGNING_SECRET?: string },
    private readonly store: LiveRoomStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly controls: LiveRoomControls,
    private readonly outputs: LiveRoomOutputs,
    private readonly preview: LiveRoomPreview,
  ) {}
  private get db(): DatabaseLike {
    return this.env.DB;
  }
  /** The point's name and signed link under the event's current key, or null when it no longer exists. */
  private async checkIn(selection: AttendancePointSelection | null, theme: LiveGraphicTheme, text: LiveCheckInText) {
    const secret = this.env.INTERNAL_SIGNING_SECRET;
    if (!selection || !secret) return null;
    const resolved = await resolveLiveCheckIn(this.db, secret, this.store.session()!.eventId, selection);
    return resolved ? { ...resolved, theme, text } : null;
  }
  async setTicker(actor: Actor, config: LiveTickerConfig | null, at: string): Promise<LiveControlOutcome> {
    const room = this.store.session()!;
    return this.controls.setTicker(
      actor,
      await resolveLiveTicker(
        this.db,
        room.eventId,
        room.session.occurrenceId,
        config,
        Date.now(),
        this.tickerContext,
        undefined,
        this.chatTicker(),
      ),
      at,
    );
  }
  async setSchedule(actor: Actor, config: LiveScheduleConfig | null, at: string): Promise<LiveControlOutcome> {
    const room = this.store.session()!;
    const schedule = config
      ? resolveUpcomingRooms(
          await readPublishedLiveAgenda(this.db, room.eventId),
          room.session.occurrenceId,
          Date.parse(at),
          config,
        )
      : null;
    return this.controls.setSchedule(actor, schedule, at);
  }
  async setStage(
    actor: Actor,
    session: LiveRoomSession,
    message: Extract<LiveRoomClientMessage, { type: "stage.set" }>,
    at: string,
  ): Promise<LiveControlOutcome> {
    return this.controls.setStage(actor, session, { ...message, ...(await this.resolve(session, message, at)) }, at);
  }
  async setAux(
    actor: Actor,
    session: LiveRoomSession,
    message: Extract<LiveRoomClientMessage, { type: "aux.set" }>,
    at: string,
  ): Promise<LiveControlOutcome> {
    const { composition } = message;
    return this.outputs.setAux(actor, session, message.output, await this.resolve(session, composition, at), at);
  }
  async setPreview(
    actor: Actor,
    session: LiveRoomSession,
    message: Extract<LiveRoomClientMessage, { type: "preview.set" }>,
    at: string,
  ): Promise<LiveControlOutcome> {
    const input = mergeLivePreview(this.store.preview(), message.composition);
    return this.preview.set(actor, session, message.composition, await this.resolve(session, input, at), at);
  }
  async takePreview(actor: Actor, session: LiveRoomSession, at: string): Promise<LiveControlOutcome> {
    return this.preview.take(actor, session, await this.resolve(session, this.preview.sources(), at), at);
  }
  /** The ticker and schedule a composition names, resolved from the approved agenda. */
  private async resolve(
    session: LiveRoomSession,
    input: LiveCompositionInput,
    at: string,
  ): Promise<ResolvedComposition> {
    const room = this.store.session()!;
    const approved = input.ticker || input.schedule ? await readPublishedLiveAgenda(this.db, room.eventId) : null;
    return {
      questionId: input.questionId,
      creditKey: input.creditKey,
      pollId: input.pollId,
      pollPresentation: input.pollPresentation,
      lowerThirdMotion: input.lowerThirdMotion,
      panelists: input.panelists,
      timerGraphics: input.timerGraphics,
      ticker: await resolveLiveTicker(
        this.db,
        room.eventId,
        session.occurrenceId,
        input.ticker,
        Date.now(),
        this.tickerContext,
        approved,
        this.chatTicker(),
      ),
      schedule: input.schedule
        ? resolveUpcomingRooms(approved, session.occurrenceId, Date.parse(at), input.schedule)
        : null,
      checkIn: input.checkIn
        ? ((await this.checkIn(input.checkIn, input.checkInTheme, input.checkInText)) ?? CHECK_IN_UNAVAILABLE)
        : null,
    };
  }
  async refresh(): Promise<void> {
    const room = this.store.session();
    if (!room) return;
    const [layouts, context] = await Promise.all([
      readLiveOverlayLayoutGeometries(this.db, room.eventId),
      readLiveTickerContext(this.db, room.eventId),
    ]);
    if (JSON.stringify(context) !== JSON.stringify(this.tickerContext)) {
      this.tickerContext = context;
      await this.broadcast.all({ type: "ticker.context.changed", context });
    }
    if (JSON.stringify(layouts) !== JSON.stringify(this.layouts)) {
      this.layouts = layouts;
      await this.broadcast.all({ type: "overlay.layouts.changed", layouts });
    }
    const stage = this.store.stage();
    const outputs = this.store.outputs();
    const preview = this.store.preview();
    const dynamic = [stage, preview, ...LIVE_AUX_OUTPUTS.map((output) => outputs[output])];
    if (!dynamic.some((composition) => composition.ticker || composition.schedule || composition.checkIn)) return;
    const approved = await readPublishedLiveAgenda(this.db, room.eventId);
    const now = Date.now();
    const chat = this.chatTicker();
    const refreshed = async <Composition extends LiveStage>(composition: Composition): Promise<Composition | null> => {
      const ticker = await resolveLiveTicker(
        this.db,
        room.eventId,
        room.session.occurrenceId,
        composition.ticker ? { style: composition.ticker.style, messages: composition.ticker.messages } : null,
        now,
        this.tickerContext,
        approved,
        chat,
      );
      const schedule = composition.schedule
        ? resolveUpcomingRooms(approved, room.session.occurrenceId, now, composition.schedule.config)
        : null;
      const content = (value: typeof schedule) =>
        value
          ? { config: value.config, available: value.available, timeZone: value.timeZone, rooms: value.rooms }
          : null;
      // A reissued key or a removed point changes the code an output shows; a removed one comes off.
      const checkIn = composition.checkIn
        ? await this.checkIn(composition.checkIn.selection, composition.checkIn.theme, composition.checkIn.text)
        : null;
      return JSON.stringify(ticker?.segments) !== JSON.stringify(composition.ticker?.segments) ||
        JSON.stringify(content(schedule)) !== JSON.stringify(content(composition.schedule)) ||
        JSON.stringify(checkIn) !== JSON.stringify(composition.checkIn)
        ? { ...composition, ticker, schedule, checkIn }
        : null;
    };
    const program = await refreshed(stage);
    if (program) {
      this.store.saveStage(program);
      await this.broadcast.all({ type: "stage.changed", stage: this.store.stage() });
    }
    for (const output of LIVE_AUX_OUTPUTS) {
      const composition = await refreshed(outputs[output]);
      if (!composition) continue;
      this.store.saveAux(output, composition);
      await this.broadcast.all({ type: "aux.changed", output, composition: this.store.aux(output) });
    }
    const shared = await refreshed(preview);
    if (shared) {
      this.store.savePreview(shared);
      await this.broadcast.all({ type: "preview.changed", composition: this.store.preview() });
    }
  }
}
