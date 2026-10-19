// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { SpeakerPortraitCard } from "../../assets/ts/ui/SpeakerPortraitCard";
import { AgendaSpeakerDirectoryCard } from "../../assets/ts/site/AgendaSpeakerDirectoryCard";
let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});
it("keeps an editable roster surface separate from a whole-card action", async () => {
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <SpeakerPortraitCard name="Casey">
        <button>Edit profile</button>
      </SpeakerPortraitCard>,
      host!,
    ),
  );
  expect(host.querySelector('article[aria-label="Speaker Casey"]')).not.toBeNull();
  expect(host.querySelector("button button")).toBeNull();
  const select = vi.fn();
  await act(() =>
    render(
      <SpeakerPortraitCard name="Casey" buttonProps={{ onClick: select, "aria-pressed": true }}>
        <strong>Casey</strong>
      </SpeakerPortraitCard>,
      host!,
    ),
  );
  const card = host.querySelector<HTMLButtonElement>("button")!;
  expect(card.getAttribute("aria-pressed")).toBe("true");
  card.click();
  expect(select).toHaveBeenCalledOnce();
});
it("opens the supplied agenda profile as a dialog with its speaker name", async () => {
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <AgendaSpeakerDirectoryCard speaker={{ name: "Casey", imageSrc: "/casey.webp" }} profileId="casey-profile" />,
      host!,
    ),
  );
  const card = host.querySelector("button[data-agenda-open-speaker]")!;
  expect(card.getAttribute("aria-controls")).toBe("casey-profile");
  expect(card.getAttribute("aria-haspopup")).toBe("dialog");
  expect(card.querySelector("strong")?.getAttribute("title")).toBe("Casey");
  expect(card.textContent).toContain("Casey");
});
