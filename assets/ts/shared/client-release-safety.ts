/** The standalone loader and Astro entry share one browser mutation state. */
const stateKey = Symbol.for("pkic.client-release-safety");
interface ReleaseSafety {
  pendingMutations: number;
  uncertainMutation: boolean;
}
function safety(): ReleaseSafety {
  const host = globalThis as typeof globalThis & { [stateKey]?: ReleaseSafety };
  return (host[stateKey] ??= { pendingMutations: 0, uncertainMutation: false });
}

/** No request or draft data is retained. */
export function beginClientMutation(): (completed: boolean) => void {
  const state = safety();
  state.pendingMutations += 1;
  return (completed) => {
    state.pendingMutations -= 1;
    // A lost response can mean a save completed. Never reload to retry it.
    if (!completed) state.uncertainMutation = true;
  };
}

export function clientMutationsAllowReload(): boolean {
  const state = safety();
  return state.pendingMutations === 0 && !state.uncertainMutation;
}
