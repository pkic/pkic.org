/** Warm both camera decoders under the public-code cache, including phones that prefer native QR decoding. */
export async function prepareScannerDecoder(
  signal: AbortSignal,
  prepareView?: () => Promise<unknown>,
): Promise<boolean> {
  if (!("serviceWorker" in navigator) || signal.aborted) return false;
  const preparation = new AbortController();
  const abort = () => preparation.abort();
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, 10000);
  try {
    const serviceWorkers = navigator.serviceWorker;
    const controlled = await new Promise<boolean>((resolve) => {
      const finish = (ready: boolean) => {
        serviceWorkers.removeEventListener("controllerchange", check);
        preparation.signal.removeEventListener("abort", cancelled);
        resolve(ready);
      };
      const check = () => {
        if (serviceWorkers.controller) finish(true);
      };
      const cancelled = () => finish(false);
      serviceWorkers.addEventListener("controllerchange", check);
      preparation.signal.addEventListener("abort", cancelled, { once: true });
      void serviceWorkers.ready.then(check).catch(cancelled);
      check();
    });
    if (!controlled || preparation.signal.aborted) return false;
    // These are the camera path's module imports, so the bundler resolves the same URLs.
    // Importing the fallback defines createWorker; it does not acquire a camera or start a worker.
    return await new Promise<boolean>((resolve, reject) => {
      const cancelled = () => resolve(false);
      preparation.signal.addEventListener("abort", cancelled, { once: true });
      void Promise.all([
        import("qr-scanner"),
        import("qr-scanner/qr-scanner-worker.min.js"),
        ...(prepareView ? [prepareView()] : []),
      ])
        .then(() => resolve(!preparation.signal.aborted))
        .catch(reject)
        .finally(() => preparation.signal.removeEventListener("abort", cancelled));
    });
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}
