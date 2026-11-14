/**
 * The signed-in person's name, email and representation, with the pencil that
 * edits their name in place. Registration and the membership application show
 * the same summary, so a person without a name on file can add it where the
 * flow asks for it.
 */
import type { ComponentChildren } from "preact";
import { ParticipationPersonalDetails, type PersonalNamePatch } from "./ParticipationPersonalDetails";
import { IconPencil } from "./icons";
import { Button } from "../ui/Button";
import { DescriptionList } from "../ui/DescriptionList";

export function PersonDetailsSummary({
  email,
  firstName,
  lastName,
  representation,
  saveNames,
  refusal,
}: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  representation?: ComponentChildren;
  saveNames?: (names: PersonalNamePatch) => Promise<void>;
  refusal?: string;
}) {
  return (
    <ParticipationPersonalDetails
      person={{ firstName: firstName ?? null, lastName: lastName ?? null }}
      save={saveNames}
      refusal={refusal}
      summary={(edit) => (
        <DescriptionList
          align="baseline"
          items={[
            ...(firstName || lastName || saveNames
              ? [
                  {
                    term: "Name",
                    value: (
                      <span class="pk-cluster pk-cluster--nowrap">
                        <span>{[firstName, lastName].filter(Boolean).join(" ") || "Add your name"}</span>
                        {edit && (
                          <Button
                            type="button"
                            variant="ghost"
                            icon
                            aria-label="Edit personal details"
                            title="Edit personal details"
                            onClick={edit}
                          >
                            <IconPencil />
                          </Button>
                        )}
                      </span>
                    ),
                  },
                ]
              : []),
            { term: "Email", value: <span class="pk-break">{email}</span> },
            ...(representation ? [{ term: "Representation", value: representation }] : []),
          ]}
        />
      )}
    />
  );
}
