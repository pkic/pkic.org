// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { ParticipantRegistrationDetails } from "../../assets/ts/components/events/ParticipantRegistrationDetails";
import { FORMS, readResponse } from "./helpers/participant-registration-fixtures";

it("preserves custom answer identity when duplicate or built-in labels change", () => {
  const host = document.createElement("div");
  const fields = ["first", "second"].map((key, sortOrder) => ({
    ...FORMS.form!.fields[0],
    key,
    label: "Name",
    sortOrder,
  }));
  const initial = readResponse();
  const data = readResponse({
    registration: { ...initial.registration, custom_answers: { first: "One", second: "Two" } },
  });
  const form = { ...FORMS.form!, fields };
  try {
    void act(() => render(<ParticipantRegistrationDetails data={data} form={form} daysSummarized />, host));
    const second = [...host.querySelectorAll("dd")].find((value) => value.textContent === "Two");
    expect(second).toBeDefined();
    void act(() =>
      render(
        <ParticipantRegistrationDetails
          data={data}
          form={{ ...form, fields: [{ ...fields[1], label: "Renamed" }] }}
          daysSummarized
        />,
        host,
      ),
    );
    expect([...host.querySelectorAll("dd")].find((value) => value.textContent === "Two")).toBe(second);
    expect(second?.previousElementSibling?.textContent).toBe("Renamed");
  } finally {
    void act(() => render(null, host));
  }
});
