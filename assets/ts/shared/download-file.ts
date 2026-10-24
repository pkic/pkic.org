export function downloadFile(content: string | Blob, type: string, filename: string): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Let the browser consume the download before releasing the transient URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
