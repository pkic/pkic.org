/**
 * resvg-wasm singleton, initialized once per worker isolate. Both the OG
 * badge renderer and the SVG logo sanitizer share this instance; keeping it
 * in a leaf utility avoids service-layer import cycles.
 */
let wasmReady: Promise<(typeof import("@resvg/resvg-wasm"))["Resvg"]> | null = null;

export function ensureResvgWasm(): Promise<(typeof import("@resvg/resvg-wasm"))["Resvg"]> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const [{ initWasm, Resvg }, wasmModule] = await Promise.all([
        import("@resvg/resvg-wasm"),
        import("@resvg/resvg-wasm/index_bg.wasm"),
      ]);
      await initWasm(wasmModule.default);
      return Resvg;
    })();
  }
  return wasmReady;
}
