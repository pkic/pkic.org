import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";
import { compileSeededBody } from "./helpers/seeded-email-partials";
import { DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES } from "../../scripts/lib/transactional-email-default-templates.mjs";

const template = DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES.find((item) => item.key === "proposal_speaker_response")!;
const variables = {
  firstName: "Jane",
  speakerName: "Jane Doe",
  eventName: "Test Conference",
  proposalTitle: "Test proposal",
  proposalUrl: "https://app.test/participation",
};

describe("speaker response decision emails", () => {
  it.each([true, false])("states approval for a speaker or reviewer (speaker: %s)", (recipientIsSpeaker) => {
    const data = { ...variables, approved: true, late: false, recipientIsSpeaker };
    expect(compileSimpleTemplate(template.subjectTemplate, data, "text")).toContain("Late speaker response approved");
    const body = compileSeededBody(template.content, data);
    expect(body).toContain(
      recipientIsSpeaker ? "approved your late response" : "approved the late response from Jane Doe",
    );
    expect(body).toContain(recipientIsSpeaker ? "View your participation" : "Review the proposal");
    expect(body).not.toContain("confirmed speaking");
    expect(body).toContain("doesn't mean the proposal is accepted");
  });
  it("addresses the speaker directly when rejecting participation", () => {
    const body = compileSeededBody(template.content, { ...variables, rejected: true, recipientIsSpeaker: true });
    expect(body).toContain("declined your late response");
    expect(body).not.toContain("Jane Doe");
  });
  it.each([false, true])("addresses a proposer-speaker directly on willingness (late: %s)", (late) => {
    const body = compileSeededBody(template.content, { ...variables, recipientIsSpeaker: true, late });
    expect(body).toContain("You confirmed speaking on **Test proposal**");
    expect(body).not.toContain("Jane Doe confirmed");
    if (late) expect(body).toContain("An organizer will review it");
    else expect(body).not.toContain("invitation deadline");
  });
  it("tells reviewers a withdrawal no longer needs a decision", () => {
    const values = { ...variables, withdrawn: true };
    expect(compileSimpleTemplate(template.subjectTemplate, values, "text")).toContain(
      "Late speaker response withdrawn",
    );
    const body = compileSeededBody(template.content, values);
    expect(body).toContain("Jane Doe withdrew their late response");
    expect(body).toContain("There is nothing left for an organizer to review.");
    expect(body).not.toContain("confirmed speaking");
  });
});
