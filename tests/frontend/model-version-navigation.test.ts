import { describe, expect, it, vi } from "vitest";
vi.mock("../../site/model-version-source", () => ({ loadModelVersion: async () => ({ levels: [] }) }));
import { modelVersionsForRoute, modelContributionEntries } from "../../site/model-versions";

describe("model version navigation context", () => {
  it("offers versions on the group landing page without declaring a different page current", async () => {
    const links = await modelVersionsForRoute("/wg/pqc/", []);
    expect(links?.items.length).toBeGreaterThan(0);
    expect(links?.activeId).toBe("");
  });
  it("identifies the released default only inside the actual model", async () => {
    const links = await modelVersionsForRoute("/wg/pqc/pqcmm/", []);
    expect(links?.activeId).toBe(links?.latestId);
    expect(links?.activeId).not.toBe("");
  });
});

it("preserves equivalent guidance pages when switching between current and draft editions", async () => {
  const route = "/wg/pqc/pqcmm/adoption/procurement/";
  const draft = "/wg/pqc/pqcmm/versions/drafts/1.1.0/adoption/procurement/";
  const links = await modelVersionsForRoute(draft, [route]);
  expect(links?.items.find((item) => item.status === "released")?.href).toBe(route);
  expect(links?.items.find((item) => item.status === "draft")?.href).toBe(draft);
});

it("identifies the exact pinned draft revision rather than its mutable branch", async () => {
  const entry = modelContributionEntries[0]!;
  const draft = entry.versions.find((version) => version.status === "draft")!;
  const navigation = await modelVersionsForRoute(draft.root, [entry.root]);
  const item = navigation!.items.find((item) => item.id === draft.id)!;
  expect(item.revision).toEqual({
    label: draft.commit.slice(0, 7),
    href: `https://github.com/${entry.repository}/commit/${draft.commit}`,
  });
});
