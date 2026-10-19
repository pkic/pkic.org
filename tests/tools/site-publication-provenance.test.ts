import { expect, it } from "vitest";
import {
  createSitePublicationSnapshot,
  createRemappedSitePublicationSnapshot,
  assertSitePublicationSourceUnchanged,
} from "../../functions/_lib/services/site-publication-snapshot-identity";
const content = {
  version: 1,
  votes: [],
  publicResources: {},
  members: [],
  groups: {},
  groupMembers: {},
  sponsors: {},
  memberWall: [],
  news: [],
  sponsorNews: [],
};
it("preserves native highwater through public media remapping instead of silently becoming an untracked fixture", async () => {
  const native = await createSitePublicationSnapshot(content, 73);
  const remapped = await createRemappedSitePublicationSnapshot(native, { ...native, eventAgendas: {} });
  expect(remapped.sourceSequence).toBe(73);
  expect(remapped.snapshotId).not.toBe(native.snapshotId);
  expect(native.sourceSequence).toBe(73);
  const fixture = await createSitePublicationSnapshot(content);
  expect((await createRemappedSitePublicationSnapshot(fixture, fixture)).sourceSequence).toBeNull();
});
it("rejects different highwater even when public content identity has not changed", async () => {
  const first = await createSitePublicationSnapshot(content, 7);
  const advanced = await createSitePublicationSnapshot(content, 8);
  expect(advanced.snapshotId).toBe(first.snapshotId);
  expect(() => assertSitePublicationSourceUnchanged(first, advanced)).toThrow("highwater changed");
  expect(() => assertSitePublicationSourceUnchanged(first, first)).not.toThrow();
  const missing = await createSitePublicationSnapshot(content);
  expect(() => assertSitePublicationSourceUnchanged(first, missing)).toThrow("highwater changed");
});
