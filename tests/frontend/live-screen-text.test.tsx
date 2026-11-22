import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { LiveScreenText } from "../../assets/ts/live-session/LiveScreenText";

describe("LiveScreenText", () => {
  let container: HTMLElement;
  afterEach(() => container.remove());
  function unbroken(text: string) {
    container = document.createElement("div");
    document.body.append(container);
    render(<LiveScreenText text={text} />, container);
    return [...container.querySelectorAll(".pk-nowrap")].map((span) => span.textContent);
  }

  it("keeps a short hyphenated name on one line", () => {
    expect(unbroken("Is ML-DSA ready for X.509-based chains?")).toEqual(["ML-DSA", "X.509-based"]);
  });

  it("lets a long hyphenated run break so the screen never cuts it off", () => {
    expect(unbroken("See draft-ietf-lamps-pq-composite-sigs today")).toEqual([]);
    expect(container.textContent).toBe("See draft-ietf-lamps-pq-composite-sigs today");
  });
});
