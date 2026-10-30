import { expect, type ConsoleMessage, type Page } from "@playwright/test";

/** Capture actual device console arguments before scanning, and await every pending serialization. */
export function captureDeviceConsole(page: Page) {
  const messages: unknown[] = [];
  const pending: Promise<void>[] = [];
  const serializationErrors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    pending.push(
      Promise.all(message.args().map((argument) => argument.jsonValue())).then(
        (args) => {
          messages.push({
            source: message.worker() ? "worker" : "page",
            type: message.type(),
            text: message.text(),
            args,
          });
        },
        (error: unknown) => {
          serializationErrors.push(String(error));
        },
      ),
    );
  };
  const onPageError = (error: Error) => {
    messages.push({ source: "pageerror", type: "pageerror", message: error.message });
  };
  page.context().on("console", onConsole);
  page.on("pageerror", onPageError);
  return async (stop = false) => {
    if (stop) {
      page.context().off("console", onConsole);
      page.off("pageerror", onPageError);
    }
    let completed = 0;
    while (completed < pending.length) {
      const batch = pending.slice(completed);
      completed += batch.length;
      await Promise.all(batch);
    }
    expect(serializationErrors, "Every observed browser console argument must be inspectable").toEqual([]);
    return [...messages];
  };
}
