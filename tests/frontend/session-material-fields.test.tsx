// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { sessionMaterialSchema } from "../../assets/shared/schemas/event-session-history";
import { MaterialFields } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionArchiveFields";
import { chooseOption, controlFor } from "./helpers/labelled-control";

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => api);

const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.clearAllMocks();
});

describe("session material fields", () => {
  it.each(["recording", "transcript", "captions"] as const)(
    "clears uploaded PDF bindings when changing to %s while preserving the supplied external URL",
    async (kind) => {
      api.getJson.mockImplementation(async (_path: string, schema: z.ZodType) =>
        schema.parse({ versions: [], page: { limit: 200, offset: 0, total: 0, hasMore: false } }),
      );
      const externalUrl = `https://media.example.test/${kind}`;
      const initial = sessionMaterialSchema.parse({
        id: "release",
        kind: "presentation",
        title: "Material",
        url: externalUrl,
        presentationSource: "session",
        presentationVersionId: "uploaded-version",
        version: 1,
        legacyDownloadUrl: "/events/event/slides.pdf",
        rightsConfirmed: false,
        consentConfirmed: false,
        validated: false,
        status: "draft",
        approvedAt: null,
      });
      const changed = vi.fn();
      function ControlledMaterials() {
        const [materials, setMaterials] = useState([initial]);
        return (
          <MaterialFields
            slug="event"
            occurrenceId="session"
            materials={materials}
            onChange={(next) => {
              changed(next);
              setMaterials(next);
            }}
          />
        );
      }
      await act(() => render(<ControlledMaterials />, host));
      expect(controlFor(host, "Uploaded slides")).toBeDefined();
      await chooseOption(controlFor(host, "Material type"), kind);
      const result = sessionMaterialSchema.parse(changed.mock.calls[0]![0][0]);
      expect(result).toMatchObject({
        kind,
        url: externalUrl,
        presentationVersionId: null,
        presentationSource: "proposal",
        legacyDownloadUrl: null,
        status: "draft",
        approvedAt: null,
      });
      expect(
        controlFor<HTMLInputElement>(
          host,
          `${{ recording: "Recording", transcript: "Transcript", captions: "Captions" }[kind]} link`,
        ).value,
      ).toBe(externalUrl);
      expect([...host.querySelectorAll("label")].map((label) => label.textContent)).not.toContain("Uploaded slides");
      expect(host.textContent).not.toContain("The selected slides will receive a download link");
      expect(host.querySelector("fieldset")?.className).toBe("pk-form-section");
      expect(host.textContent).not.toContain("Find uploaded version");
      expect(host.textContent).not.toContain("Previous uploads");
      expect(host.textContent).not.toContain("Next uploads");
      const version = controlFor<HTMLInputElement>(host, "Version");
      expect(version.value).toBe("1");
      for (const label of ["Version", "Release status", "We have permission to publish this material"]) {
        const control = controlFor<HTMLInputElement>(host, label);
        expect(control.closest('details,[hidden],[aria-hidden="true"]')).toBeNull();
        expect(control.disabled).toBe(false);
      }
      expect(initial.presentationVersionId).toBe("uploaded-version");
      expect(initial.kind).toBe("presentation");
    },
  );
});
