import { describe, expect, it } from "vitest";
import { OPENAPI_TAG_GROUPS, OPENAPI_TAGS } from "../functions/_lib/openapi/document";
import { openapi } from "../functions/router";

/**
 * The published spec is the reference developers actually read. It used to
 * carry only a title and a version, so ReDoc opened on an unexplained, flat,
 * alphabetical list of tags. These assertions guard the parts of that fix that
 * silently rot: a tag added to a route but never described, or a described tag
 * grouped under a section that no longer exists.
 */
function spec() {
  return openapi.schema as {
    info?: { title?: string; version?: string; description?: string };
    tags?: { name: string }[];
    paths?: Record<string, Record<string, { tags?: string[] } | undefined>>;
  };
}

function tagsUsedByOperations(): Set<string> {
  const used = new Set<string>();
  for (const item of Object.values(spec().paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      for (const tag of item?.[method]?.tags ?? []) used.add(tag);
    }
  }
  return used;
}

describe("OpenAPI document metadata", () => {
  it("explains what the API is and how to authenticate", () => {
    const info = spec().info;
    expect(info?.title).toBeTruthy();
    expect(info?.version).toBeTruthy();
    // Not a length check for its own sake: these are the sections a consumer
    // cannot work without.
    expect(info?.description).toContain("## Authentication");
    expect(info?.description).toContain("## Conventions");
  });

  it("describes every tag its operations actually use", () => {
    const described = new Set(OPENAPI_TAGS.map((tag) => tag.name));
    const undescribed = [...tagsUsedByOperations()].filter((tag) => !described.has(tag)).sort();
    expect(undescribed).toEqual([]);
  });

  it("does not describe tags no operation uses", () => {
    const used = tagsUsedByOperations();
    const orphaned = OPENAPI_TAGS.map((tag) => tag.name)
      .filter((tag) => !used.has(tag))
      .sort();
    expect(orphaned).toEqual([]);
  });

  it("groups only tags that exist", () => {
    const described = new Set(OPENAPI_TAGS.map((tag) => tag.name));
    const unknown = OPENAPI_TAG_GROUPS.flatMap((group) => group.tags)
      .filter((tag) => !described.has(tag))
      .sort();
    expect(unknown).toEqual([]);
  });

  it("places every described tag in exactly one sidebar group", () => {
    const counts = new Map<string, number>();
    for (const group of OPENAPI_TAG_GROUPS) {
      for (const tag of group.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const misplaced = OPENAPI_TAGS.map((tag) => tag.name)
      .filter((tag) => counts.get(tag) !== 1)
      .sort();
    expect(misplaced).toEqual([]);
  });
});
