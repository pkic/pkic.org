import { expect, it, vi } from "vitest";
import { reloadForServerRelease } from "../../assets/ts/event-screens/screen-release";

const memory = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
};

it("reloads a screen once for each newer server release, and never for its own or an unnamed one", () => {
  const storage = memory();
  const reload = vi.fn();
  expect(reloadForServerRelease("a1b2c3", storage, reload, "a1b2c3")).toBe(false);
  expect(reloadForServerRelease(null, storage, reload, "a1b2c3")).toBe(false);
  expect(reloadForServerRelease("d4e5f6", storage, reload, "dev")).toBe(false);
  expect(reload).not.toHaveBeenCalled();

  expect(reloadForServerRelease("d4e5f6", storage, reload, "a1b2c3")).toBe(true);
  // The reloaded page still differs, as one a cache served would: no loop.
  expect(reloadForServerRelease("d4e5f6", storage, reload, "a1b2c3")).toBe(false);
  // The next deploy reloads it again.
  expect(reloadForServerRelease("070809", storage, reload, "a1b2c3")).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});

it("keeps the page when it cannot note the reload, so a reload can never repeat", () => {
  const reload = vi.fn();
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(reloadForServerRelease("d4e5f6", broken, reload, "a1b2c3")).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});
