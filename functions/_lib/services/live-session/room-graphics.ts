import type { LiveCheckInText } from "../../../../assets/shared/schemas/live-session-graphic-settings";
import type { LiveRoomGraphicBasis } from "./room-graphic-basis";
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
import type { LiveRoomControls, LiveControlOutcome } from "./room-controls";
import type { LiveRoomOutputs } from "./room-outputs";
import type { LiveRoomPreview } from "./room-preview";
import { liveCompositionInput, mergeLivePreview } from "../../../../assets/shared/live-room-preview";
import { liveOutputFixedScene, liveRoomOutputs } from "../../../../assets/shared/live-room-outputs";
import { nowIso } from "../../utils/time";
import { resolveLiveSceneElements } from "../../../../assets/shared/live-scene-elements";
import { liveSceneFill, type LiveSceneFill } from "../../../../assets/shared/live-scene-fill";
import type { ResolvedComposition } from "./room-composition";
import type { LiveOverlayLayoutGeometry } from "../../../../assets/shared/schemas/live-overlay-layout";
import type { DatabaseLike } from "../../types";
import type { LiveRoomStore } from "./room-store";
import type { LiveRoomBroadcast } from "./room-broadcast";
import { readLiveOverlayLayoutGeometries } from "./overlay-layouts";
import { readEventLiveStudioSetup } from "./studio-setup";
import { resolveLiveTicker } from "./room-ticker";
import { resolveLiveCheckIn } from "../event-attendance-points/live-check-in";
import type { AttendancePointSelection } from "../../../../assets/shared/attendance-points";
import type { LiveGraphicTheme } from "../../../../assets/shared/live-graphic-theme";
import type { LiveRoomOnScreenLists } from "./room-on-screen-lists";
import { liveTickerConfigOf } from "../../../../assets/shared/schemas/live-session-ticker";

/** A check-in code the room cannot show: its day, room or session is gone, or codes are unavailable. */
const CHECK_IN_UNAVAILABLE = {
  code: "LIVE_CHECK_IN_UNAVAILABLE",
  message: "That check-in code is no longer available. Choose another one.",
};

type Actor = { userId: string; name: string };

/** Event geometry and computed ticker text refresh together; neither replaces the persisted source config. */
export class LiveRoomGraphics {
  private refreshing: Promise<void> | undefined;
  layouts: LiveOverlayLayoutGeometry[] = [];
  tickerContext: LiveTickerContext = DEFAULT_LIVE_TICKER_CONTEXT;
  /** The attendee chat lines a chat ticker may show now. */
  chatTicker: () => Promise<string[]> = async () => [];
  constructor(
    /** The database, and the secret that signs check-in codes; without it no output can show one. */
    private readonly env: { DB: DatabaseLike; INTERNAL_SIGNING_SECRET?: string },
    private readonly store: LiveRoomStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly controls: LiveRoomControls,
    private readonly outputs: LiveRoomOutputs,
    private readonly preview: LiveRoomPreview,
    private readonly basis: LiveRoomGraphicBasis,
    /** The audience lists an output shows, which the room fills from its own questions and chat. */
    readonly lists: LiveRoomOnScreenLists,
  ) {
    const saved = basis.read();
    this.layouts = saved.layouts;
    this.tickerContext = saved.context;
  }
  private get db(): DatabaseLike {
    return this.env.DB;
  }
  /** The point's name and signed link under the event's current key, or null when it no longer exists. */
  private async checkIn(
    selection: AttendancePointSelection | null,
    theme: LiveGraphicTheme,
    text: LiveCheckInText,
    fresh = false,
  ) {
    const secret = this.env.INTERNAL_SIGNING_SECRET;
    if (!selection || !secret) return null;
    // An already prepared code stays local during transitions and appearance edits.
    // Background refresh still resolves its point and signing key canonically.
    if (!fresh) {
      const outputs = this.store.outputs();
      const existing = [this.store.stage(), this.store.preview(), ...Object.values(outputs)]
        .map((composition) => composition.checkIn)
        .find((graphic) => graphic && JSON.stringify(graphic.selection) === JSON.stringify(selection));
      if (existing) return { ...existing, theme, text };
    }
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
        this.basis.read().agenda,
        await this.chatTicker(),
      ),
      at,
    );
  }
  async setSchedule(actor: Actor, config: LiveScheduleConfig | null, at: string): Promise<LiveControlOutcome> {
    const room = this.store.session()!;
    const schedule = config
      ? resolveUpcomingRooms(this.basis.read().agenda, room.session.occurrenceId, Date.parse(at), config)
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
    // A screen its room locked to a scene keeps that scene, whatever scene a shot names.
    const scene = liveOutputFixedScene(liveRoomOutputs(session), message.output) ?? message.composition.scene;
    const composition = { ...message.composition, scene };
    return this.outputs.setAux(actor, session, message.output, await this.resolve(session, composition, at), at);
  }
  /**
   * Changes the scene a room screen draws, as loading a scene does on
   * Preview: the screen keeps everything it holds, and the scene's comes-on
   * graphics that are off there go on. A screen its room locked to a scene
   * stays in that scene.
   */
  async setAuxScene(
    actor: Actor,
    session: LiveRoomSession,
    message: Extract<LiveRoomClientMessage, { type: "aux.scene" }>,
    at: string,
  ): Promise<LiveControlOutcome> {
    const scene = liveOutputFixedScene(liveRoomOutputs(session), message.output) ?? message.scene;
    const held = { ...liveCompositionInput(this.store.aux(message.output)), scene };
    const composition = { ...held, ...this.comesOn(held) };
    return this.outputs.setAux(actor, session, message.output, await this.resolve(session, composition, at), at);
  }
  async setPreview(
    actor: Actor,
    session: LiveRoomSession,
    message: Extract<LiveRoomClientMessage, { type: "preview.set" }>,
    at: string,
  ): Promise<LiveControlOutcome> {
    const merged = mergeLivePreview(this.store.preview(), message.composition);
    // Loading a scene switches on the graphics that come on with it, in the same one write. A layer the
    // change itself names stays as the operator set it.
    const loaded = "scene" in message.composition ? this.comesOn(merged) : {};
    const patch = { ...loaded, ...message.composition };
    return this.preview.set(actor, session, patch, await this.resolve(session, { ...merged, ...patch }, at), at);
  }
  /**
   * What loading its scene switches on for a composition, on Preview or a
   * room screen alike: the scene's comes-on graphics that are off there,
   * filled from the room.
   */
  private comesOn(input: LiveCompositionInput): LiveSceneFill {
    const scene = resolveLiveSceneElements({ overlayLayouts: this.layouts }, input.scene);
    return liveSceneFill(scene, input, { program: this.store.stage(), setup: this.basis.read().graphics });
  }
  /**
   * A screen draws the scene its room set up for it from the start, before
   * anyone takes anything to it: the room loads that scene on the screen once.
   * On a screen that follows Program that switches on what comes on with the
   * scene; on one that shows what you take to it nothing comes on by itself.
   * Everything the screen holds stays. After a take, only a locked screen
   * goes back to its scene; a screen
   * already in its scene is left alone, so a graphic an operator switched off
   * there stays off.
   */
  private async loadSetUpScenes(): Promise<void> {
    const room = this.store.session();
    if (!room) return;
    const at = nowIso();
    for (const output of liveRoomOutputs(room.session)) {
      if (output.role === "speaker" || !output.scene) continue;
      if (!output.sceneLocked && this.store.composed(output.key)) continue;
      const held = this.store.aux(output.key);
      if (held.scene === output.scene) continue;
      const input = { ...liveCompositionInput(held), scene: output.scene };
      const fill = output.role === "follow" ? this.comesOn(input) : {};
      const resolved: Record<string, unknown> = await this.resolve(room.session, { ...input, ...fill }, at);
      // Only what the scene switched on changes; the store reads the whole composition again before it saves.
      const brought = Object.fromEntries(Object.keys(fill).map((graphic) => [graphic, resolved[graphic]]));
      const message = this.outputs.adopt(output.key, held, { ...held, ...brought, scene: output.scene });
      if (message) await this.broadcast.all(message);
    }
  }
  async takePreview(actor: Actor, session: LiveRoomSession, at: string): Promise<LiveControlOutcome> {
    return this.preview.take(actor, session, await this.resolve(session, this.preview.sources(), at), at);
  }
  /** What a composition names, resolved: ticker and schedule from the approved agenda, its lists from the room. */
  private async resolve(
    session: LiveRoomSession,
    input: LiveCompositionInput,
    at: string,
  ): Promise<ResolvedComposition> {
    const room = this.store.session()!;
    const approved = this.basis.read().agenda;
    // Messages still waiting when the chat goes on show once their wait is over.
    if (input.chatFeed?.delaySeconds) this.lists.due();
    return {
      questionId: input.questionId,
      creditKey: input.creditKey,
      pollId: input.pollId,
      pollPresentation: input.pollPresentation,
      lowerThirdMotion: input.lowerThirdMotion,
      panelists: input.panelists,
      timerGraphics: input.timerGraphics,
      topQuestions: input.topQuestions && this.lists.topQuestions(input.topQuestions),
      chatFeed: input.chatFeed && (await this.lists.chatFeed(input.chatFeed)),
      reactions: input.reactions,
      reactionsGraphic: input.reactionsGraphic,
      scene: input.scene,
      ticker: await resolveLiveTicker(
        this.db,
        room.eventId,
        session.occurrenceId,
        input.ticker,
        Date.now(),
        this.tickerContext,
        approved,
        await this.chatTicker(),
      ),
      schedule: input.schedule
        ? resolveUpcomingRooms(approved, session.occurrenceId, Date.parse(at), input.schedule)
        : null,
      checkIn: input.checkIn
        ? ((await this.checkIn(input.checkIn, input.checkInTheme, input.checkInText)) ?? CHECK_IN_UNAVAILABLE)
        : null,
    };
  }
  /** Later joins reuse the persisted basis instead of repeating every event-wide graphics read. */
  async initialize(): Promise<void> {
    if (!this.basis.ready) await this.refresh();
    else await this.refreshLocal();
    await this.loadSetUpLowerThird();
    await this.loadSetUpScenes();
  }

  /**
   * A fresh room puts lower thirds on and off air the way the event's setup
   * says, before anyone sets Preview or Program. Once an operator has, the
   * room keeps their choice.
   */
  private async loadSetUpLowerThird(): Promise<void> {
    const motion = this.basis.read().graphics.lowerThird?.motion;
    if (!motion || this.store.programStarted() || this.store.stage().lowerThirdMotion === motion) return;
    const stage = { ...this.store.stage(), lowerThirdMotion: motion };
    this.store.saveStage(stage);
    await this.broadcast.all({ type: "stage.changed", stage });
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshFromD1();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async refreshFromD1(): Promise<void> {
    const room = this.store.session();
    if (!room) return;
    const [layouts, context, agenda, setup] = await Promise.all([
      readLiveOverlayLayoutGeometries(this.db, room.eventId),
      readLiveTickerContext(this.db, room.eventId),
      readPublishedLiveAgenda(this.db, room.eventId),
      readEventLiveStudioSetup(this.db, room.eventId),
    ]);
    this.basis.save({ layouts, context, agenda, graphics: setup.graphics });
    if (JSON.stringify(context) !== JSON.stringify(this.tickerContext)) {
      this.tickerContext = context;
      await this.broadcast.all({ type: "ticker.context.changed", context });
    }
    if (JSON.stringify(layouts) !== JSON.stringify(this.layouts)) {
      this.layouts = layouts;
      await this.broadcast.all({ type: "overlay.layouts.changed", layouts });
    }
    await this.refreshCompositions(true);
    // The audience lists also refill on this cadence, so a message whose wait ended while nothing changed shows.
    await this.lists.refresh();
  }

  /** Recompute room-local chat and time-dependent graphics without querying D1. */
  async refreshLocal(): Promise<void> {
    await this.refreshCompositions(false);
  }

  private async refreshCompositions(freshCheckIn: boolean): Promise<void> {
    const room = this.store.session();
    if (!room) return;
    const stage = this.store.stage();
    const outputs = this.store.outputs();
    const preview = this.store.preview();
    const dynamic = [stage, preview, ...Object.values(outputs)];
    if (!dynamic.some((composition) => composition.ticker || composition.schedule || composition.checkIn)) return;
    const approved = this.basis.read().agenda;
    const now = Date.now();
    const chat = await this.chatTicker();
    const refreshed = async <Composition extends LiveStage>(composition: Composition): Promise<Composition | null> => {
      const ticker = await resolveLiveTicker(
        this.db,
        room.eventId,
        room.session.occurrenceId,
        composition.ticker ? liveTickerConfigOf(composition.ticker) : null,
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
      const checkIn =
        composition.checkIn && freshCheckIn
          ? await this.checkIn(composition.checkIn.selection, composition.checkIn.theme, composition.checkIn.text, true)
          : composition.checkIn;
      return JSON.stringify(ticker?.segments) !== JSON.stringify(composition.ticker?.segments) ||
        JSON.stringify(content(schedule)) !== JSON.stringify(content(composition.schedule)) ||
        JSON.stringify(checkIn) !== JSON.stringify(composition.checkIn)
        ? { ...composition, ticker, schedule, checkIn }
        : null;
    };
    const program = await refreshed(stage);
    if (program && JSON.stringify(this.store.stage()) === JSON.stringify(stage)) {
      this.store.saveStage(program);
      await this.broadcast.all({ type: "stage.changed", stage: this.store.stage() });
    }
    for (const [output, held] of Object.entries(outputs)) {
      const composition = await refreshed(held);
      if (!composition || JSON.stringify(this.store.aux(output)) !== JSON.stringify(held)) continue;
      this.store.saveAux(output, composition);
      await this.broadcast.all({ type: "aux.changed", output, composition: this.store.aux(output) });
    }
    const shared = await refreshed(preview);
    if (shared && JSON.stringify(this.store.preview()) === JSON.stringify(preview)) {
      this.store.savePreview(shared);
      await this.broadcast.all({ type: "preview.changed", composition: this.store.preview() });
    }
  }
}
