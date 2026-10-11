// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

async function mountPreview() {
  document.body.innerHTML = '<iframe sandbox=""></iframe>';
  await import("../../assets/ts/site/email-preview-document");
  return document.querySelector("iframe")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("accepts rendered HTML only from the same-origin parent with the shared contract", async () => {
  const frame = await mountPreview();
  const send = (data: unknown, source: Window, origin: string) =>
    window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  const html = '<style>p { color: green; }</style><p style="background: white">Organization form</p>';
  send({ html }, window, "https://unrelated.example");
  expect(frame.srcdoc).toBe("");
  send({ html }, frame.contentWindow!, location.origin);
  expect(frame.srcdoc).toBe("");
  send({ html: 42 }, window.parent, location.origin);
  expect(frame.srcdoc).toBe("");
  send({ html }, window.parent, location.origin);
  expect(frame.srcdoc).toBe(html);
  expect(frame.getAttribute("sandbox")).toBe("");
  vi.resetModules();
});
