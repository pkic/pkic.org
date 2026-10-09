import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../../assets/ts/shared/clipboard";

function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
  Reflect.deleteProperty(document as unknown as Record<string, unknown>, "execCommand");
});

const feedback = (notify: (message: string, type: string) => void) => ({
  copied: "Link copied.",
  failed: "Select the link and copy it.",
  notify,
});

describe("copyText", () => {
  it("writes through the Clipboard API and reports success", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    installClipboard(writeText);
    const notify = vi.fn();

    await expect(copyText("https://pkic.org/x", feedback(notify))).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://pkic.org/x");
    expect(notify).toHaveBeenCalledWith("Link copied.", "success");
  });

  it("falls back to a selection copy when the Clipboard API refuses", async () => {
    installClipboard(() => Promise.reject(new Error("denied")));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    const notify = vi.fn();

    await expect(copyText("fallback text", feedback(notify))).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(notify).toHaveBeenCalledWith("Link copied.", "success");
    // The temporary field is gone again.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports how to copy by hand when every route is refused", async () => {
    installClipboard(() => Promise.reject(new Error("denied")));
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    const notify = vi.fn();

    await expect(copyText("nope", feedback(notify))).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith("Select the link and copy it.", "error");
  });

  it("copies without saying anything when the caller reports the outcome itself", async () => {
    installClipboard(() => Promise.resolve());
    await expect(copyText("quiet")).resolves.toBe(true);
  });
});
