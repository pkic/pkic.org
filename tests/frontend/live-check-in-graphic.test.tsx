// @vitest-environment jsdom
import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../assets/shared/schemas/live-session-graphic-settings";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  EMPTY_LIVE_STAGE,
  liveRoomClientMessageSchema,
  type LiveCheckInOnAir,
  type LiveOverlayView,
} from "../../assets/shared/schemas/live-session-room";
import { LiveOverlay } from "../../assets/ts/live-session/LiveOverlay";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import {
  liveAuxToggle,
  liveLayerShown,
  liveLayerToggle,
  livePreviewToggle,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
import {
  livePreviewDifferences,
  previewLiveStage,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-stage-preview";
import { fakeLiveSockets, LIVE_OCCURRENCE, liveSnapshot } from "./helpers/live-room-socket";
import { LIVE_GRAPHIC_THEMES } from "../../assets/shared/live-graphic-theme";
import { LiveCheckInOverlay } from "../../assets/ts/live-session/LiveCheckInOverlay";
import { CheckInQrGraphic } from "../../assets/ts/components/attendance-points/CheckInQrGraphic";
import { contrastRatio, parseHex } from "../../assets/design/color";
import { constants } from "../../assets/design/tokens";

const token = `pkc1_${"a".repeat(40)}.${"b".repeat(43)}`;
const checkIn: LiveCheckInOnAir = {
  selection: { kind: "session", occurrenceId: LIVE_OCCURRENCE },
  label: "Post-quantum migration",
  path: `/portal/#/events/pqc-2026/check-in/${token}`,
  theme: "white-on-black",
  text: DEFAULT_LIVE_CHECK_IN_TEXT,
};
const layer = { kind: "checkIn" as const, checkIn };
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

function mount(view: LiveOverlayView) {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() =>
    render(
      <LiveOverlay
        view={view}
        layout="full-frame"
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        token="signed.overlay.access"
        createSocket={live.factory}
      />,
      host,
    ),
  );
  void act(() => {
    live.latest().open();
    live.latest().deliver(
      liveSnapshot({
        viewer: { role: "overlay", name: null },
        stage: { ...EMPTY_LIVE_STAGE, checkIn },
        outputs: { ...EMPTY_LIVE_OUTPUTS, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, checkIn } },
      }),
    );
  });
  return host;
}

describe("check-in code on live outputs", () => {
  it("sends the chosen code as a selection for Program and an auxiliary output, never a link", () => {
    const program = liveLayerToggle(EMPTY_LIVE_STAGE, layer);
    expect(liveRoomClientMessageSchema.parse(program)).toMatchObject({ type: "stage.set", checkIn: checkIn.selection });
    expect(JSON.stringify(program)).not.toContain(token);
    expect(liveLayerToggle({ ...EMPTY_LIVE_STAGE, checkIn }, layer)).toMatchObject({ checkIn: null });

    const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
    const aux = liveAuxToggle(state, "projector", layer);
    expect(liveRoomClientMessageSchema.parse(aux)).toMatchObject({
      type: "aux.set",
      output: "projector",
      composition: { checkIn: checkIn.selection },
    });
  });

  it("sends the code to the shared Preview as a selection, which the room signs", () => {
    const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
    expect(liveRoomClientMessageSchema.parse(livePreviewToggle(state, layer))).toEqual({
      type: "preview.set",
      composition: {
        checkIn: checkIn.selection,
        checkInTheme: "white-on-black",
        checkInText: DEFAULT_LIVE_CHECK_IN_TEXT,
      },
    });
    const preview = previewLiveStage(state, EMPTY_LIVE_STAGE, liveLayerToggle(EMPTY_LIVE_STAGE, layer), checkIn);
    expect(preview.checkIn).toEqual(checkIn);
    expect(liveLayerShown(preview, layer)).toBe(true);
  });

  it("carries changed check-in text through a destination toggle and counts it as one composition difference", () => {
    const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" } }))!;
    const configured = { ...checkIn, text: { visible: false, template: "**{{checkIn.label}}**" } };
    const layer = { kind: "checkIn" as const, checkIn: configured };
    const patch = liveRoomClientMessageSchema.parse(livePreviewToggle(state, layer));
    expect(patch).toMatchObject({ type: "preview.set", composition: { checkInText: configured.text } });
    const current = { ...EMPTY_LIVE_STAGE, checkIn };
    expect(liveLayerShown(current, layer)).toBe(false);
    const next = previewLiveStage(state, current, liveLayerToggle(current, layer), configured);
    expect(next.checkIn?.text).toEqual(configured.text);
    expect(livePreviewDifferences(next, current)).toBe(1);
    expect(livePreviewDifferences(current, next)).toBe(1);
  });

  it.each(["program", "projector", "stage-preview", "stage-display"] as const)(
    "draws the code only on the outputs whose composition shows it (%s)",
    (view) => {
      const host = mount(view);
      const code = host.querySelector('svg[aria-label="Check-in code: Post-quantum migration"]');
      if (view === "program" || view === "projector")
        expect(code?.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
      else expect(code).toBeNull();
    },
  );

  it.each(LIVE_GRAPHIC_THEMES)("draws the code in the %s theme with its quiet zone", (theme) => {
    const host = document.body.appendChild(document.createElement("div"));
    hosts.push(host);
    void act(() => render(<LiveCheckInOverlay checkIn={{ ...checkIn, theme }} />, host));
    const graphic = host.querySelector<HTMLElement>(".pk-live-check-in")!;
    // The whole graphic, code included, takes the theme the operator chose.
    expect(graphic.dataset.graphicTheme).toBe(theme);
    const code = host.querySelector("svg.pk-check-in-qr__code")!;
    const ground = code.querySelector("rect.pk-check-in-qr__ground")!;
    // The ground spans the whole viewBox, so the four-module quiet zone stays clear of anything else.
    expect(ground.getAttribute("width")).toBe(code.getAttribute("viewBox")!.split(" ")[2]);
    expect(code.querySelector("path.pk-check-in-qr__modules")?.getAttribute("d")).toMatch(/^M4 4h1/);
  });

  it("renders sections and sanitized inline Markdown without repeating session details", () => {
    const host = document.body.appendChild(document.createElement("div"));
    hosts.push(host);
    void act(() =>
      render(
        <LiveCheckInOverlay
          checkIn={{
            ...checkIn,
            label: '<img src=x onerror="alert(1)">',
            text: { visible: true, template: "{{#checkIn}}**Scan** *{{label}}*{{/checkIn}}<script>alert(1)</script>" },
          }}
        />,
        host,
      ),
    );
    expect(host.querySelector(".pk-check-in-qr__label")).toBeNull();
    expect(host.querySelector(".pk-check-in-qr__note strong")?.textContent).toBe("Scan");
    expect(host.querySelector(".pk-check-in-qr__note em")?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(host.querySelector("img, script")).toBeNull();
  });

  it.each([
    { visible: false, template: "Scan to check in" },
    { visible: true, template: "{{#missing}}Hidden{{/missing}}" },
  ])("keeps the code accessible without an empty caption when instruction is $visible", (text) => {
    const host = document.body.appendChild(document.createElement("div"));
    hosts.push(host);
    void act(() => render(<LiveCheckInOverlay checkIn={{ ...checkIn, text }} />, host));
    expect(host.querySelector(".pk-check-in-qr__caption")).toBeNull();
    expect(host.querySelector("svg")?.getAttribute("aria-label")).toBe(`Check-in code: ${checkIn.label}`);
  });

  it("keeps the code's own spacing in its own width, so it grows with its box", () => {
    const css = readFileSync(
      resolve(process.cwd(), "assets/ts/components/attendance-points/CheckInQrGraphic.css"),
      "utf8",
    );
    // Container units on the container itself would resolve against the broadcast frame.
    const container = /\.pk-check-in-qr \{([^}]*)\}/u.exec(css)![1]!;
    expect(container).toContain("container-type: inline-size");
    expect(container).not.toMatch(/cqi/u);
  });

  it("keeps the solid themes' code at a scanner contrast far above what readers need", () => {
    const modules = parseHex(constants["on-solid-ink"]),
      plate = parseHex(constants["on-solid"]);
    expect(contrastRatio(modules, plate)).toBeGreaterThanOrEqual(7);
    // The card's words read at body-text contrast on every opaque ground.
    expect(contrastRatio(parseHex(constants["on-solid"]), parseHex(constants["chrome-deep"]))).toBeGreaterThan(7);
    expect(contrastRatio(parseHex(constants["pqc-ink"]), parseHex(constants["pqc-paper"]))).toBeGreaterThan(7);
  });
});

describe("check-in code graphic options", () => {
  function draw(node: preact.ComponentChildren) {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    void act(() => render(node, host));
    return host;
  }

  it("hides the point's name on request but keeps it in the code's accessible name", () => {
    const host = draw(<CheckInQrGraphic point={checkIn} showLabel={false} caption="Scan to check in" />);
    expect(host.querySelector(".pk-check-in-qr__label")).toBeNull();
    expect(host.querySelector(".pk-check-in-qr__note")?.textContent).toBe("Scan to check in");
    expect(host.querySelector("svg")?.getAttribute("aria-label")).toBe("Check-in code: Post-quantum migration");
  });

  it("hosts a rich caption and omits an empty caption container", () => {
    const rich = draw(<CheckInQrGraphic point={checkIn} caption={<strong>Scan now</strong>} />);
    expect(rich.querySelector(".pk-check-in-qr__note strong")?.textContent).toBe("Scan now");

    const bare = draw(<CheckInQrGraphic point={checkIn} showLabel={false} caption="" />);
    expect(bare.querySelector(".pk-check-in-qr__caption")).toBeNull();
  });
});
