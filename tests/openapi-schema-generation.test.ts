import { z } from "zod";
import { describe, expect, it } from "vitest";
import { registrationConfirmResponseSchema } from "../assets/shared/schemas/api";
import { AUTH_EXTENSION, decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("OpenAPI schema generation", () => {
  it("generates the full API document", () => {
    expect(() => openapi.schema).not.toThrow();
  });

  it("includes required scopes on decorated admin operations", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const operation = spec.paths["/api/v1/admin/proposals/{proposalId}/reviews"].post;

    expect(operation.security).toEqual([{ BearerAuth: ["proposal-reviews:write"] }]);
    expect(operation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["proposal-reviews:write"],
    });
    expect(operation["x-pkic-required-scopes"]).toEqual(["proposal-reviews:write"]);
    expect(operation.description).toContain("Required scopes: `proposal-reviews:write`.");
  });

  it("uses structured schemas for registration confirmation day arrays", () => {
    const dayAttendanceSchema = registrationConfirmResponseSchema.shape.dayAttendance;
    const dayWaitlistSchema = registrationConfirmResponseSchema.shape.dayWaitlist;

    expect(z.toJSONSchema(dayAttendanceSchema)).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["dayDate", "attendanceType"],
      },
    });
    expect(z.toJSONSchema(dayWaitlistSchema)).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["dayDate", "status", "priorityLane", "offerExpiresAt"],
      },
    });
  });
});
