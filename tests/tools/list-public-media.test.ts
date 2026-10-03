import { expect, it, vi } from "vitest";
import { listPublicMedia } from "../../scripts/publication/list-public-media.mjs";

it("lists each bucket by pages and retains only selected objects", async () => {
  const first = {
    list: vi
      .fn()
      .mockResolvedValueOnce({
        objects: [
          { key: "a", etag: "one", size: 1 },
          { key: "private", etag: "hidden", size: 1 },
        ],
        truncated: true,
        cursor: "next",
      })
      .mockResolvedValueOnce({ objects: [{ key: "b", etag: "two", size: 2 }], truncated: false }),
  };
  const second = {
    list: vi.fn().mockResolvedValue({ objects: [{ key: "c", etag: "three", size: 3 }], truncated: false }),
  };
  const manifest = await listPublicMedia(["a", "a", "b", "c"], (key: string) => (key === "c" ? second : first));
  expect([...manifest.keys()]).toEqual(["a", "b", "c"]);
  expect(first.list).toHaveBeenCalledTimes(2);
  expect(first.list).toHaveBeenLastCalledWith({ limit: 1000, cursor: "next" });
  expect(second.list).toHaveBeenCalledOnce();
});
