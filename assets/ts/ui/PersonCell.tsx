import type { ComponentChildren, JSX } from "preact";

import { personRoleAt } from "../../shared/person-display";
import { Avatar, type AvatarProps } from "./Avatar";
import "./PersonCell.css";

export type PersonCellSize = "sm" | "md";

/**
 * The one way a person appears in a row, a table cell or a picker result:
 * face first, then the name, then a quiet second line: the identity they
 * act as, "CTO at Example Org". An email address is not shown by default; a
 * row whose purpose is the address, such as the email outbox, passes it as
 * `detail`.
 */
export interface PersonCellProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "size" | "title"> {
  name: string;
  /** The identity's title and organization, read from the identity the person acts as. */
  title?: string | null;
  organization?: string | null;
  /**
   * A second line that says something else, an organization's slogan or a
   * search result's note. Set in the same quiet type, in place of the rest.
   */
  detail?: ComponentChildren;
  avatarSrc?: string | null;
  avatarStatus?: AvatarProps["status"];
  /** `square` for an organization, whose mark is a logo rather than a face. */
  shape?: AvatarProps["shape"];
  size?: PersonCellSize;
}

export function PersonCell({
  name,
  title,
  organization,
  detail,
  avatarSrc,
  avatarStatus,
  shape,
  size = "md",
  class: className,
  ...rest
}: PersonCellProps) {
  const classes = ["pk-person-cell", size === "md" ? null : `pk-person-cell--${size}`, className]
    .filter(Boolean)
    .join(" ");
  const roleAt = personRoleAt({ title, organization });
  const second = detail ?? (roleAt || null);

  return (
    <div class={classes} {...rest}>
      <Avatar name={name} src={avatarSrc ?? undefined} size={size} shape={shape} status={avatarStatus} />
      <div class="pk-person-cell__text">
        <div class="pk-person-cell__name" title={name}>
          {name}
        </div>
        {second ? (
          <div class="pk-person-cell__email" title={typeof second === "string" ? second : undefined}>
            {second}
          </div>
        ) : null}
      </div>
    </div>
  );
}
