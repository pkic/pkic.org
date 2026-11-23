import { env } from "cloudflare:workers";
import { downloadZip } from "client-zip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../functions/_lib/types";
import {
  checkPendingPresentations,
  checkPresentationVersion,
} from "../functions/_lib/services/content-checks/presentation-checks";
import { extractPresentationText } from "../functions/_lib/services/content-checks/presentation-text";
import { readContentCheckResult } from "../functions/_lib/services/content-checks/results";
import { proposalIdentityFixture, submitIdentityProposal } from "./helpers/proposal-identity";
import { saveCheckSettings, sampleFlag } from "./helpers/content-check-settings";
import { resetDb } from "./helpers/reset-db";

function slideXml(...paragraphs: string[]) {
  return `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${paragraphs
    .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
    .join("")}</p:spTree></p:cSld></p:sld>`;
}

async function pptx(slides: string[][]): Promise<ArrayBuffer> {
  return downloadZip([
    { name: "[Content_Types].xml", input: "<Types/>" },
    // Stored last slide first: the order of the slides comes from their numbers.
    ...slides
      .map((paragraphs, index) => ({
        name: `ppt/slides/slide${String(index + 1)}.xml`,
        input: slideXml(...paragraphs),
      }))
      .reverse(),
  ]).arrayBuffer();
}

/** A stand-in check model: slides that sell are flagged, everything else passes. */
const model = {
  run: vi.fn(async (_model: string, input: { state: { slides: string }; questions: Record<string, unknown> }) => ({
    answers: Object.fromEntries(
      Object.keys(input.questions).map((id) => [
        id,
        { noul: id === "promotional" && input.state.slides.includes("Request a demo") ? 0.8 : 0.02 },
      ]),
    ),
  })),
  toMarkdown: vi.fn(),
};
const checkedEnv = { ...env, AI: model } as unknown as Env;

async function proposal() {
  const { token, body } = await proposalIdentityFixture();
  return (await (await submitIdentityProposal(body, token)).json<{ proposalId: string }>()).proposalId;
}

async function uploadedVersion(fileName: string, bytes: ArrayBuffer, proposalId?: string, versionNumber = 1) {
  proposalId ??= await proposal();
  const versionId = crypto.randomUUID();
  const r2Key = `presentations/test/${versionId}-${fileName}`;
  await env.SPEAKER_UPLOADS_BUCKET!.put(r2Key, bytes);
  await env.DB.prepare(
    `INSERT INTO presentation_versions (id, proposal_id, version_number, r2_key, file_name, file_size, mime_type, uploaded_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      versionId,
      proposalId,
      versionNumber,
      r2Key,
      fileName,
      bytes.byteLength,
      new Date().toISOString(),
      versionNumber === 1 ? 1 : 0,
    )
    .run();
  return versionId;
}

describe("automatic check of uploaded slides", () => {
  beforeEach(async () => {
    await resetDb();
    model.run.mockClear();
    await saveCheckSettings("presentation", [sampleFlag("promotional", "These slides read as marketing.", null)]);
  });

  it("reads PowerPoint slides in order, one paragraph per line", async () => {
    const text = await extractPresentationText(checkedEnv, {
      bytes: await pptx([["Lessons from a CA migration"], ["Inventory first", "Rotate keys &amp; certificates"]]),
      fileName: "talk.pptx",
    });
    expect(text).toBe("Slide 1:\nLessons from a CA migration\n\nSlide 2:\nInventory first\nRotate keys & certificates");
  });

  it("flags promotional slides for organizers and checks each version once", async () => {
    const versionId = await uploadedVersion("talk.pptx", await pptx([["Our product"], ["Request a demo today"]]));
    expect(await checkPendingPresentations(checkedEnv)).toMatchObject({ checked: 1 });
    const result = await readContentCheckResult(env.DB, "presentation", versionId);
    expect(result).toMatchObject({ outcome: "advised", flags: [{ id: "promotional" }] });
    expect(model.run.mock.calls[0]?.[1].state.slides).toContain("Request a demo today");
    expect(await checkPendingPresentations(checkedEnv)).toMatchObject({ checked: 0 });
  });

  it("leaves a file it cannot read unchecked, and retries when the model fails", async () => {
    const proposalId = await proposal();
    const keynote = await uploadedVersion("talk.key", new ArrayBuffer(16), proposalId);
    expect(await checkPresentationVersion(checkedEnv, keynote)).toBe("unchecked");
    expect(await readContentCheckResult(env.DB, "presentation", keynote)).toMatchObject({ outcome: "unchecked" });

    model.run.mockRejectedValueOnce(new Error("model unavailable"));
    const slides = await uploadedVersion("talk.pptx", await pptx([["Lessons learned"]]), proposalId, 2);
    expect(await checkPresentationVersion(checkedEnv, slides)).toBe("retry");
    expect(await readContentCheckResult(env.DB, "presentation", slides)).toBeNull();
    expect(await checkPresentationVersion(checkedEnv, slides)).toBe("checked");
  });

  it("ignores character references outside Unicode instead of failing", async () => {
    const text = await extractPresentationText(checkedEnv, {
      bytes: await pptx([["Keys&#x110000; and&#0; certs &#65;"]]),
      fileName: "talk.pptx",
    });
    expect(text).toBe("Slide 1:\nKeys and certs A");
  });

  it("gives up on a version after repeated failures and does not let it starve newer uploads", async () => {
    const proposalId = await proposal();
    const failing = await uploadedVersion("talk.pptx", await pptx([["Failing"]]), proposalId);
    model.run.mockRejectedValue(new Error("model unavailable"));
    try {
      expect(await checkPresentationVersion(checkedEnv, failing)).toBe("retry");
      expect(await checkPresentationVersion(checkedEnv, failing)).toBe("retry");
      expect(await checkPresentationVersion(checkedEnv, failing)).toBe("unchecked");
    } finally {
      model.run.mockReset();
      model.run.mockImplementation(async (_m, input) => ({
        answers: Object.fromEntries(Object.keys(input.questions).map((id) => [id, { noul: 0.02 }])),
      }));
    }
    expect(await readContentCheckResult(env.DB, "presentation", failing)).toMatchObject({ outcome: "unchecked" });

    const older = await uploadedVersion("talk.pptx", await pptx([["Older"]]), proposalId, 2);
    await env.DB.prepare("UPDATE presentation_versions SET content_check_attempts = 2 WHERE id = ?").bind(older).run();
    const fresh = await uploadedVersion("talk.pptx", await pptx([["Fresh"]]), proposalId, 3);
    expect(await checkPendingPresentations(checkedEnv, 1)).toMatchObject({ checked: 1 });
    expect(await readContentCheckResult(env.DB, "presentation", fresh)).toMatchObject({ outcome: "passed" });
    expect(await readContentCheckResult(env.DB, "presentation", older)).toBeNull();
  });
});
