import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { defaultPromotionComposition } from "../../assets/shared/schemas/event-promotion-design";
import type { Env } from "../../functions/_lib/types";
import type { PromotionRenderData } from "../../functions/_lib/services/event-agenda/promotion-render";
import { renderPromotionArtifact } from "../../functions/_lib/services/event-agenda/promotion-artifact";
import { ensureResvgWasm } from "../../functions/_lib/utils/resvg";
import { encodeRenderedPng } from "../../functions/_lib/utils/image-encoding";

const rasterize = vi.spyOn(Resvg.prototype, "render");
const png = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=", "base64"),
);
vi.mock("../../functions/_lib/services/event-agenda/promotion-artwork-inputs", () => ({
  preparePromotionArtwork: async (_env: Env, _origin: string, source: PromotionRenderData) => ({
    source,
    fonts: [
      readFileSync("static/fonts/PromotionRoboto-Regular.ttf"),
      readFileSync("static/fonts/PromotionRoboto-Bold.ttf"),
    ],
  }),
}));
vi.mock("../../functions/_lib/utils/resvg", () => ({ ensureResvgWasm: vi.fn() }));
vi.mock("../../functions/_lib/utils/image-encoding", () => ({ THUMBNAIL_OUTPUT: {}, encodeRenderedPng: vi.fn() }));

const agenda = agendaSnapshotSchema.parse({
  eventSlug: "example",
  eventName: "Example event",
  revision: 1,
  publishedRevision: 1,
  timeZone: "UTC",
  rooms: [],
  shifts: [],
  assignments: [],
  roleMembers: [],
  occurrences: [
    {
      id: "session",
      title: "Example session",
      description: "",
      speakers: [],
      startAt: null,
      endAt: null,
      roomId: null,
    },
  ],
});
const source: PromotionRenderData = {
  agenda,
  occurrence: agenda.occurrences[0]!,
  registrationUrl: "https://example.test/r/synthetic",
  composition: { ...defaultPromotionComposition(), panels: ["cover"] },
  copy: {
    whyAttend: "Example session",
    takeaways: [],
    callToAction: "Register",
    campaign: "example",
    approvedAt: null,
  },
};
beforeAll(async () => {
  await initWasm(readFileSync(new URL("../../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)));
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureResvgWasm).mockResolvedValue(Resvg);
  vi.mocked(encodeRenderedPng).mockResolvedValue({ bytes: png, contentType: "image/webp" });
});

it("renders a direct PDF without rasterizing or encoding an unused cover thumbnail", async () => {
  const artifact = await renderPromotionArtifact({} as Env, "https://example.test", source, "carousel", {
    thumbnail: false,
  });
  expect(artifact.body).toBeInstanceOf(Uint8Array);
  const pdf = await PDFDocument.load(artifact.body as Uint8Array);
  expect(rasterize).toHaveBeenCalledTimes(pdf.getPageCount());
  expect(encodeRenderedPng).not.toHaveBeenCalled();
  expect(artifact).not.toHaveProperty("thumbnail");
});

it("preserves the cover thumbnail for queued PDF renders", async () => {
  const artifact = await renderPromotionArtifact({} as Env, "https://example.test", source, "carousel");
  const pdf = await PDFDocument.load(artifact.body as Uint8Array);
  expect(rasterize).toHaveBeenCalledTimes(pdf.getPageCount() + 1);
  expect(encodeRenderedPng).toHaveBeenCalledOnce();
  expect(artifact.thumbnail).toMatchObject({ contentType: "image/webp" });
});
