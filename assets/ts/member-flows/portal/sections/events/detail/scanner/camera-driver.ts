/** One camera stream stays open while successive badges are decoded. */
export async function openBadgeCamera(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  onActive: (active: boolean) => void,
  registerStop: (stop: () => void) => void,
): Promise<void> {
  let stopped = false;
  let reader: { start(): Promise<void>; destroy(): void } | null = null;
  registerStop(() => {
    stopped = true;
    reader?.destroy();
    onActive(false);
  });
  try {
    const { default: QrScanner } = await import("qr-scanner");
    if (stopped) return;
    reader = new QrScanner(
      video,
      (code) => {
        if (!stopped) onCode(code.data);
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 8,
        returnDetailedScanResult: true,
      },
    );
    await reader.start();
    if (stopped) reader.destroy();
    else onActive(true);
  } catch (error) {
    reader?.destroy();
    if (stopped) return;
    onActive(false);
    throw error;
  }
}
