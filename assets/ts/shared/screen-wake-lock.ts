/**
 * A screen wake lock, held for a page that must not let the device sleep:
 * the event scanner and a browser set up as a screen. The lock needs no
 * click, only a visible page, and the browser takes it away whenever the
 * page is hidden or the system decides to; whoever holds it says when to
 * ask again.
 */

export interface ScreenWakeLockSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export interface ScreenWakeLockApi {
  request(type: "screen"): Promise<ScreenWakeLockSentinel>;
}

const browserWakeLock = (): ScreenWakeLockApi | undefined => (navigator as { wakeLock?: ScreenWakeLockApi }).wakeLock;

export function screenWakeLock(
  /** Whether the screen is kept awake, each time that changes or is confirmed. */
  onAwake: (awake: boolean) => void,
  options: {
    /** The browser's wake lock, read when asked; replaced in tests. */
    wakeLock?: () => ScreenWakeLockApi | undefined;
    /** The browser let the held lock go while it was still wanted. */
    onReleased?: () => void;
  } = {},
) {
  const { wakeLock = browserWakeLock, onReleased } = options;
  let disposed = false;
  let lock: ScreenWakeLockSentinel | undefined;
  let asking: Promise<boolean> | null = null;
  /** Counts releases: a request made before the latest one is let go as it arrives. */
  let releases = 0;

  /** Asks for the lock, once at a time; resolves with whether it is held. A browser without one, or that refuses, leaves the screen as it was. */
  function acquire(): Promise<boolean> {
    if (lock && !lock.released) return Promise.resolve(true);
    if (asking) return asking;
    const current = ask(releases).finally(() => {
      if (asking === current) asking = null;
    });
    asking = current;
    return current;
  }

  async function ask(asked: number): Promise<boolean> {
    try {
      const next = await wakeLock()?.request("screen");
      if (disposed || asked !== releases) {
        await next?.release();
        return false;
      }
      lock = next;
      const awake = Boolean(next && !next.released);
      onAwake(awake);
      next?.addEventListener("release", () => {
        if (disposed || lock !== next) return;
        onAwake(false);
        onReleased?.();
      });
      return awake;
    } catch {
      /* A screen wake lock is optional. */
      return false;
    }
  }

  /** Lets the lock go, and one still being asked for as it arrives; a later acquire asks afresh. */
  function release() {
    releases += 1;
    asking = null;
    onAwake(false);
    const held = lock;
    lock = undefined;
    void held?.release().catch(() => {});
  }

  return {
    acquire,
    release,
    /** Lets the lock go for good; a request still in flight is let go as it arrives. */
    dispose() {
      disposed = true;
      release();
    },
  };
}
