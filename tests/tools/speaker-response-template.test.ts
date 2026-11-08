import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";
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
    expect(compileSimpleTemplate(template.subjectTemplate, data, "text")).toContain(
      "Late speaker participation approved",
    );
    const body = compileSimpleTemplate(template.content, data, "markdown");
    expect(body).toContain(
      recipientIsSpeaker ? "approved your late participation" : "approved late participation by Jane Doe",
    );
    expect(body).toContain(recipientIsSpeaker ? "View your participation" : "Review the proposal");
    expect(body).not.toContain("is willing to participate");
    expect(body).toContain("does not accept the proposal");
  });
  it("addresses the speaker directly when rejecting participation", () => {
    const body = compileSimpleTemplate(
      template.content,
      { ...variables, rejected: true, recipientIsSpeaker: true },
      "markdown",
    );
    expect(body).toContain("declined your late participation");
    expect(body).not.toContain("declined late participation by Jane Doe");
  });
  it.each([false, true])("addresses a proposer-speaker directly on willingness (late: %s)", (late) => {
    const body = compileSimpleTemplate(template.content, { ...variables, recipientIsSpeaker: true, late }, "markdown");
    expect(body).toContain("You are willing to participate");
    expect(body).not.toContain("Jane Doe is willing");
    expect(body).not.toContain("Their willingness");
    expect(body).toContain(
      late ? "Participation awaits" : "Your willingness to participate in the proposal is confirmed.",
    );
  });
  it("tells reviewers a withdrawal no longer needs a decision", () => {
    const values = { ...variables, withdrawn: true };
    expect(compileSimpleTemplate(template.subjectTemplate, values, "text")).toContain(
      "Late speaker response withdrawn",
    );
    const body = compileSimpleTemplate(template.content, values, "markdown");
    expect(body).toContain("Jane Doe withdrew their late response");
    expect(body).toContain("It no longer awaits organizer review.");
    expect(body).not.toContain("is willing to participate");
  });
});
