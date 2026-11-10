// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { parseScreenPageAddress } from "../../assets/ts/event-screens/screen-address";
import { ScreenPairing } from "../../assets/ts/event-screens/ScreenStatus";

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});

it("reads the screen ID from the fragment only, as the screen prints it", () => {
  expect(parseScreenPageAddress({ hash: "#id=K7M2QA" })).toEqual({ screenId: "K7M2QA" });
  expect(parseScreenPageAddress({ hash: "#id=k7m2qa" })).toEqual({ screenId: "K7M2QA" });
  expect(parseScreenPageAddress({ hash: "#id=K7M2Q1" })).toBeNull();
  expect(parseScreenPageAddress({ hash: "" })).toBeNull();
});

it("shows the pairing code and the screen ID staff enter together", async () => {
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<ScreenPairing screenId="K7M2QA" pairing={{ code: "HJKP4QRT", expiresIn: "9:41" }} />, host!));
  const values = [...host.querySelectorAll("dd")].map((value) => value.textContent);
  expect(values).toEqual(["HJKP4QRT", "K7M2QA"]);
});
