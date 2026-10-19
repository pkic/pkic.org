import { usePersonCard, personAffiliation } from "../../site/PersonCard";
import { Button, ButtonLink } from "../../ui/Button";
import { PersonCell, type PersonCellProps } from "../../ui/PersonCell";
import "./PersonCellPreview.css";

/** Roster names navigate when permitted and share the canonical person preview. */
export function PersonCellPreview({ profilePath, ...person }: PersonCellProps & { profilePath?: string | null }) {
  const preview = usePersonCard<HTMLSpanElement>({
    side: "right",
    person: {
      name: person.name,
      photoUrl: person.avatarSrc,
      affiliation: personAffiliation(person.title, person.organization),
      profilePath,
    },
  });
  const cell = <PersonCell {...person} />;
  return (
    <span class="pk-live-person-preview" ref={preview.anchorRef} {...preview.hoverProps}>
      {profilePath ? (
        <ButtonLink variant="ghost" href={profilePath} class="pk-person-cell-preview">
          {cell}
        </ButtonLink>
      ) : (
        <Button variant="ghost" type="button" class="pk-person-cell-preview" {...preview.toggleProps}>
          {cell}
        </Button>
      )}
      {preview.card}
    </span>
  );
}
