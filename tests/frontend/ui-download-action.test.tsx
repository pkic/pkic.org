// @vitest-environment jsdom
/**
 * The shared download control: always the download glyph, named by what it
 * downloads, a link for a URL, busy while a generated file is being built,
 * and a split button when several formats are offered.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { DownloadAction } from "../../assets/ts/ui/DownloadAction";

const mounted: HTMLElement[] = [];

async function mount(node: ComponentChildren): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => render(node, container));
  return container;
}

afterEach(async () => {
  for (const container of mounted.splice(0)) {
    await act(() => render(null, container));
    container.remove();
  }
});

describe("DownloadAction", () => {
  it("renders a URL download as an icon-only link named by what it downloads", async () => {
    const host = await mount(
      <DownloadAction label="Download session demand (CSV)" href="/exports?q=a" filename="demand.csv" />,
    );
    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/exports?q=a");
    expect(link.getAttribute("download")).toBe("demand.csv");
    expect(link.getAttribute("aria-label")).toBe("Download session demand (CSV)");
    expect(link.getAttribute("title")).toBe("Download session demand (CSV)");
    expect(link.className).toContain("pk-btn--secondary");
    expect(link.className).toContain("pk-btn--icon");
    expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(link.textContent).toBe("");
  });

  it("asks for a download without naming the file when the filename is true", async () => {
    const host = await mount(<DownloadAction label="Download version 1, talk.pdf" href="/content" filename />);
    expect(host.querySelector("a")!.getAttribute("download")).toBe("");
  });

  it("leaves a URL download as a navigation when no filename is requested", async () => {
    const host = await mount(<DownloadAction label="Download scan log (CSV)" href="/attempts/exports" />);
    expect(host.querySelector("a")!.hasAttribute("download")).toBe(false);
  });

  it("renders an unavailable URL download as a disabled button rather than a live link", async () => {
    const host = await mount(<DownloadAction label="Download roster (CSV)" href="/roster" disabled />);
    expect(host.querySelector("a")).toBeNull();
    const button = host.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Download roster (CSV)");
  });

  it("stays busy while a generated download is built and keeps its accessible name", async () => {
    let finish!: () => void;
    const onDownload = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const host = await mount(<DownloadAction label="Download recovery file (JSON)" onDownload={onDownload} />);
    const button = host.querySelector("button")!;
    expect(button.type).toBe("button");
    await act(() => button.click());
    expect(onDownload).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Download recovery file (JSON)");
    await act(() => button.click());
    expect(onDownload).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("reflects the caller's busy state", async () => {
    const host = await mount(<DownloadAction label="Download recovery file (JSON)" busy onDownload={() => {}} />);
    expect(host.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  });

  it("offers several formats through a split button whose glyph downloads the first", async () => {
    const host = await mount(
      <DownloadAction
        label="Download current presentations"
        menuLabel="Presentation download options"
        options={[
          { id: "current", label: "Current presentations", href: "/archive" },
          { id: "all", label: "All presentation versions", href: "/archive?versions=all" },
        ]}
      />,
    );
    expect(host.querySelector(".pk-split-button--secondary")).not.toBeNull();
    const primary = host.querySelector<HTMLAnchorElement>('a[aria-label="Download current presentations"]')!;
    expect(primary.getAttribute("href")).toBe("/archive");
    expect(primary.querySelector("svg")).not.toBeNull();
    const menu = host.querySelector<HTMLButtonElement>('button[aria-label="Presentation download options"]')!;
    await act(() => menu.click());
    const items = [...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
    expect(items.map((item) => [item.textContent?.trim(), item.getAttribute("href")])).toEqual([
      ["Current presentations", "/archive"],
      ["All presentation versions", "/archive?versions=all"],
    ]);
  });

  it("runs a generated option from the split button", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const host = await mount(
      <DownloadAction
        label="Download badge files (HTML)"
        menuLabel="Badge file formats"
        options={[
          { id: "html", label: "HTML print file", onDownload: first },
          { id: "csv", label: "Printing CSV", onDownload: second },
        ]}
      />,
    );
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Download badge files (HTML)"]')!.click());
    expect(first).toHaveBeenCalledOnce();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Badge file formats"]')!.click());
    await act(() =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === "Printing CSV")!
        .click(),
    );
    expect(second).toHaveBeenCalledOnce();
  });
});
