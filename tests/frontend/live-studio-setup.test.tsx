// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  eventLiveStudioSetupPutSchema,
  type EventLiveStudioSetupResponse,
} from "../../assets/shared/schemas/live-studio-setup";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import {
  useLiveStudioSetup,
  type LiveStudioSetupHandle,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-studio-setup";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  getJson: mocks.get,
  putJson: mocks.put,
}));

const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  mocks.get.mockReset();
  mocks.put.mockReset();
});

const ticker = {
  style: "accent" as const,
  speed: 90,
  messages: [{ id: "wifi", prefix: "Wi-Fi", template: "PKIC-guest", condition: "always" as const }],
};

async function mount() {
  let handle: LiveStudioSetupHandle | undefined;
  function Harness() {
    handle = useLiveStudioSetup("pqc-2026", true);
    return null;
  }
  await act(async () => render(<Harness />, host));
  return () => handle!;
}

it("saves one graphic over someone else's newer setup instead of undoing it", async () => {
  const first: EventLiveStudioSetupResponse = { graphics: {}, layouts: {}, updatedAt: "2030-01-01T09:00:00.000Z" };
  const theirs: EventLiveStudioSetupResponse = {
    graphics: { topQuestions: { count: 4 } },
    layouts: {},
    updatedAt: "2030-01-01T09:05:00.000Z",
  };
  mocks.get.mockResolvedValueOnce(first).mockResolvedValueOnce(theirs);
  mocks.put
    .mockRejectedValueOnce(
      new ApiClientError({ error: { code: "LIVE_STUDIO_SETUP_CHANGED", message: "Changed" } }, 409),
    )
    .mockImplementationOnce(async (_url: string, body: unknown) => ({
      ...eventLiveStudioSetupPutSchema.parse(body),
      updatedAt: "2030-01-01T09:06:00.000Z",
    }));
  const setup = await mount();
  let problem: string | null = "unset";
  await act(async () => {
    problem = await setup().saveGraphic("ticker", ticker);
  });
  expect(problem).toBeNull();
  const retried = eventLiveStudioSetupPutSchema.parse(mocks.put.mock.calls[1]![1]);
  expect(retried.expectedUpdatedAt).toBe(theirs.updatedAt);
  expect(retried.graphics).toEqual({ topQuestions: { count: 4 }, ticker });
  expect(setup().graphics).toEqual({ topQuestions: { count: 4 }, ticker });
});

it("says the setup was not saved when the connection drops, and keeps what it had", async () => {
  mocks.get.mockResolvedValueOnce({ graphics: { ticker }, layouts: {}, updatedAt: "2030-01-01T09:00:00.000Z" });
  mocks.put.mockRejectedValueOnce(new ApiClientError({ error: { code: "NETWORK", message: "offline" } }, 0));
  const setup = await mount();
  let problem: string | null = null;
  await act(async () => {
    problem = await setup().saveGraphic("topQuestions", { count: 2 });
  });
  expect(problem).toMatch(/not saved/);
  expect(setup().graphics).toEqual({ ticker });
});
