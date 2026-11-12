export function downloadFile(content: string | Blob, type: string, filename: string): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Let the browser consume the download before releasing the transient URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Starts the download of a file the server sends as an attachment, without leaving the page. */
export function downloadUrl(href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  link.click();
}
