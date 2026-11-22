import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_ROOM_OUTPUTS,
  liveRoomOutputsRequestSchema,
  liveRoomOutputsResponseSchema,
} from "../assets/shared/schemas/live-room-output-setup";
import { liveRoomOutputKey } from "../functions/_lib/services/live-session/room-output-setup";
import { createLiveRoomFixture } from "./helpers/live-session-room";
import { callApi } from "./helpers/app";

const f = createLiveRoomFixture();
const headers = (token = f.tokens.operator) => ({
  authorization: `Bearer ${token}`,
  origin: "https://app.test",
  "content-type": "application/json",
});
const read = (token?: string) => callApi(env, f.programPath("/outputs"), { headers: headers(token) });
const save = (outputs: unknown[], token?: string) =>
  callApi(env, f.programPath("/outputs"), {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify({ outputs }),
  });

describe("a room's outputs", () => {
  beforeEach(() => f.setup());

  it("lists the projector and the speaker's screen until anyone sets them up", async () => {
    const response = await read();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(liveRoomOutputsResponseSchema.parse(await response.json()).outputs).toEqual(DEFAULT_LIVE_ROOM_OUTPUTS);
  });

  it("saves the list in its order, keeps a key for good and gives the speaker's screen its fixed key", async () => {
    const saved = await save([
      { key: "projector", name: "Screen left", code: "PRJ L", role: "follow", scene: null, sceneLocked: false },
      { name: "Screen right", code: "PRJ R", role: "follow", scene: "break", sceneLocked: true },
      { name: "Speaker", code: "DSP", role: "speaker", scene: null, sceneLocked: false },
      { name: "Foyer", code: "foy", role: "exact", scene: null, sceneLocked: false },
    ]);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const outputs = liveRoomOutputsResponseSchema.parse(await saved.json()).outputs;
    expect(outputs.map(({ key, code }) => [key, code])).toEqual([
      ["projector", "PRJ L"],
      ["prj-r", "PRJ R"],
      ["stage-display", "DSP"],
      ["foy", "FOY"],
    ]);
    expect(outputs[1]).toMatchObject({ scene: "break", sceneLocked: true });
    const listed = liveRoomOutputsResponseSchema.parse(await (await read()).json()).outputs;
    expect(listed).toEqual(outputs);
  });

  it("refuses a code in use, a second speaker's screen and an empty list", async () => {
    for (const outputs of [
      [
        { name: "Left", code: "PRJ", role: "follow", scene: null, sceneLocked: false },
        { name: "Right", code: "PRJ", role: "follow", scene: null, sceneLocked: false },
      ],
      [{ name: "Program again", code: "PGM", role: "exact", scene: null, sceneLocked: false }],
      [
        { name: "Speaker", code: "DSP", role: "speaker", scene: null, sceneLocked: false },
        { name: "Lectern", code: "LEC", role: "speaker", scene: null, sceneLocked: false },
      ],
      [],
    ]) {
      const response = await save(outputs);
      expect(response.status, JSON.stringify(outputs)).toBe(400);
    }
  });

  it("is only for the room's live moderators", async () => {
    expect((await read(f.tokens.attendee)).status).toBe(403);
    expect((await save([...DEFAULT_LIVE_ROOM_OUTPUTS], f.tokens.attendee)).status).toBe(403);
  });
});

describe("a new output's key", () => {
  it("comes from its code and stays clear of the keys in use and the room's own names", () => {
    expect(liveRoomOutputKey("PRJ L", new Set())).toBe("prj-l");
    expect(liveRoomOutputKey("PRJ L", new Set(["prj-l"]))).toBe("prj-l-2");
    expect(liveRoomOutputKey("PGM", new Set())).toBe("pgm");
    expect(liveRoomOutputKey("2", new Set())).toBe("output-2");
    expect(liveRoomOutputKey("DSP", new Set())).toBe("dsp");
  });

  it("is never one the room keeps for its buses", () => {
    const key = liveRoomOutputKey("PREVIEW", new Set());
    expect(key).toBe("preview-2");
    expect(
      liveRoomOutputsRequestSchema.safeParse({
        outputs: [{ key: "preview", name: "X", code: "X", role: "exact", scene: null, sceneLocked: false }],
      }).success,
    ).toBe(false);
  });
});
