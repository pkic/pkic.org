import { parse } from "yaml";
import { modelRegistrySchema } from "../../assets/shared/model-registry";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { modelDraftSchema, modelVersionLinks } from "../../assets/shared/model-versions";
import { verifyModelVersion } from "../../site/model-version-source";
import { modelVersionMarkdown } from "../../site/model-version-markdown";

const bytes = readFileSync("tests/fixtures/model-preview.yaml", "utf8");
const digest = createHash("sha256").update(bytes).digest("hex");
const draft = modelDraftSchema.parse({
  id: "assessment-methods",
  version: "1.1.0",
  status: "draft",
  root: "/wg/pqc/pqcmm/drafts/1.1.0/",
  branch: "agent/review",
  commit: "a".repeat(40),
  sha256: digest,
});

describe("registered model drafts", () => {
  it("rejects changed bytes and an internal version inconsistent with the registered expected version", () => {
    expect(verifyModelVersion(bytes, draft).model.version).toBe("1.1.0");
    expect(() => verifyModelVersion(`${bytes}\n`, draft)).toThrow(/digest mismatch/);
    expect(() => verifyModelVersion(bytes, { ...draft, version: "2.0.0" })).toThrow(/version mismatch/);
  });
  it("requires explicit commit and digest pins rather than following a branch automatically", () => {
    expect(() => modelDraftSchema.parse({ ...draft, commit: "main" })).toThrow();
    expect(() => modelDraftSchema.parse({ ...draft, sha256: undefined })).toThrow();
    expect(() => modelDraftSchema.parse({ ...draft, root: "/wg/pqc/pqcmm/drafts/../" })).toThrow();
  });
  it("keeps draft identity while allowing its expected release and URL to change", () => {
    const revised = modelDraftSchema.parse({
      ...draft,
      version: "2.0.0",
      root: "/wg/pqc/pqcmm/drafts/2.0.0/",
      aliases: [draft.root],
    });
    expect(revised.id).toBe(draft.id);
    expect(revised.aliases).toContain(draft.root);
    const links = modelVersionLinks(
      [draft, { ...revised, id: "scope-review", aliases: [] }],
      `${revised.root}levels/1-initial/`,
    );
    expect(links.activeId).toBe("scope-review");
    expect(links.items.map((v) => v.label)).toEqual(["1.1.0 — Draft", "2.0.0 — Draft"]);
  });
  it("preserves an equivalent level and falls back to the overview when absent", () => {
    const other = { ...draft, id: "scope-review", version: "2.0.0", root: "/wg/pqc/pqcmm/drafts/2.0.0/" };
    const path = "levels/1-initial/";
    const routes = new Set([`${other.root}${path}`]);
    expect(modelVersionLinks([draft, other], `${draft.root}${path}`, routes).items[1].href).toBe(
      `${other.root}${path}`,
    );
    expect(modelVersionLinks([draft, other], `${draft.root}missing/`, routes).items[1].href).toBe(other.root);
  });
  it("renders criteria, checks and evidence while keeping level links inside the selected draft", () => {
    const parsed = verifyModelVersion(bytes, draft);
    const markdown = modelVersionMarkdown(parsed, draft.root, 1);
    expect(markdown).toContain("Criterion 1.1.1");
    expect(markdown).toContain("Question 1.2.1");
    expect(markdown).toContain("Evidence 1.e.1");
    expect(markdown).toContain(`${draft.root}levels/1-initial/`);
    expect(markdown).not.toContain("](/wg/pqc/pqcmm/levels/");
  });
});

describe("version namespace ownership", () => {
  const registry = () => modelRegistrySchema.parse(parse(readFileSync("data/model-versions.yaml", "utf8")));
  it("rejects a draft alias that claims a released address", () => {
    const value = registry();
    value.models[0]!.versions[1]!.aliases = ["/wg/pqc/pqcmm/versions/9.0.0/"];
    expect(() => modelRegistrySchema.parse(value)).toThrow();
  });
  it.each(["/wg/pqc/pqcmm/versions/not-a-release/", "/wg/pqc/pqcmm/drafts/nested/extra/"])(
    "rejects malformed released aliases such as %s",
    (alias) => {
      const value = registry();
      value.models[0]!.versions[0]!.aliases = [alias];
      expect(() => modelRegistrySchema.parse(value)).toThrow(/namespace/);
    },
  );
  it("rejects a released primary root in the draft namespace", () => {
    const value = registry();
    value.models[0]!.versions[0]!.root = "/wg/pqc/pqcmm/versions/drafts/1.0.1/";
    expect(() => modelRegistrySchema.parse(value)).toThrow(/namespace/);
  });
  it("retains both current and legacy draft redirects when a draft is released", () => {
    const value = registry();
    const entry = value.models[0]!;
    const draft = entry.versions[1]!;
    entry.versions[1] = {
      ...draft,
      status: "released",
      tag: `v${draft.version}`,
      root: `${entry.root}versions/${draft.version}/`,
      aliases: [draft.root, ...draft.aliases],
    };
    expect(modelRegistrySchema.parse(value).models[0]!.versions[1]!.aliases).toContain(draft.root);
  });
});
