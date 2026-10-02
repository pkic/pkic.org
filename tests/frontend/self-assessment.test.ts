import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("script[data-self-assessment-script]").forEach((script) => script.remove());
  vi.resetModules();
});

it("rejects an unapproved assessment version without loading remote code", async () => {
  document.body.innerHTML = '<div data-self-assessment data-version="develop"></div>';
  await import("../../assets/ts/site/self-assessment");
  expect(document.querySelector("[role=alert]")?.textContent).toContain("could not be loaded");
  expect(document.querySelector("script[data-self-assessment-script]")).toBeNull();
});

it("requires integrity verification and shows an actionable error when the approved bundle fails", async () => {
  document.body.innerHTML = '<div data-self-assessment data-version="v2.0.0"></div>';
  await import("../../assets/ts/site/self-assessment");
  const script = document.querySelector<HTMLScriptElement>("script[data-self-assessment-script]");
  expect(script?.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
  expect(script?.crossOrigin).toBe("anonymous");
  script?.dispatchEvent(new Event("error"));
  expect(document.querySelector("[role=alert]")?.textContent).toContain("reload this page");
  expect(document.querySelector("self-assessment")).toBeNull();
});
