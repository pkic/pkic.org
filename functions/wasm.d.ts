/**
 * TypeScript ambient module declaration for WebAssembly binary imports.
 *
 * Wrangler resolves *.wasm imports at bundle time and exposes them as
 * WebAssembly.Module instances, so code can call `initWasm(module)` directly
 * without an extra fetch round-trip.
 */
declare module "*.wasm" {
  const mod: WebAssembly.Module;
  export default mod;
}
