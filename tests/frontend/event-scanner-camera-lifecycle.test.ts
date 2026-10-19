import { describe, expect, it, vi } from "vitest";

const loading = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, constructed: vi.fn(), starts: vi.fn(), destroys: vi.fn() };
});
vi.mock("qr-scanner", async () => {
  await loading.ready;
  return {
    default: class {
      constructor() {
        loading.constructed();
      }
      async start() {
        loading.starts();
      }
      destroy() {
        loading.destroys();
      }
    },
  };
});
import { openBadgeCamera } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/camera-driver";

describe("phone camera acquisition lifecycle", () => {
  it("registers cancellation before decoder import and never acquires a stream after Exit", async () => {
    let stop = () => {};
    const active = vi.fn();
    const pending = openBadgeCamera(document.createElement("video"), vi.fn(), active, (value) => {
      stop = value;
    });
    stop();
    loading.release();
    await pending;
    expect(loading.constructed).not.toHaveBeenCalled();
    expect(loading.starts).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledWith(false);
    expect(active).not.toHaveBeenCalledWith(true);
  });
});
