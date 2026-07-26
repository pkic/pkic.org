// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseLookupParams } from "../../assets/ts/member-flows/application-status-page";

describe("parseLookupParams", () => {
  it("reads id and token from the query string", () => {
    expect(parseLookupParams("?id=app-123&token=tok-abc")).toEqual({ id: "app-123", token: "tok-abc" });
  });

  it("returns null when either param is missing", () => {
    expect(parseLookupParams("?id=app-123")).toBeNull();
    expect(parseLookupParams("?token=tok-abc")).toBeNull();
    expect(parseLookupParams("")).toBeNull();
  });

  it("returns null for blank values", () => {
    expect(parseLookupParams("?id=&token=tok-abc")).toBeNull();
  });
});
