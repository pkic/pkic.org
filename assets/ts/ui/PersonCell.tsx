import type { ComponentChildren, JSX } from "preact";

import { Avatar, type AvatarProps } from "./Avatar";
import "./PersonCell.css";

export type PersonCellSize = "sm" | "md";

export interface PersonCellProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "size"> {
  name: string;
  email?: string;
  /**
   * A second line that is not an address — an organization's slogan, a
   * person's job title. Set in the same quiet type as the address; a cell
   * carries one or the other, not both.
   */
  detail?: ComponentChildren;
  avatarSrc?: string;
  avatarStatus?: AvatarProps["status"];
  /** `square` for an organization, whose mark is a logo rather than a face. */
  shape?: AvatarProps["shape"];
  size?: PersonCellSize;
}

export function PersonCell({
  name,
  email,
  detail,
  avatarSrc,
  avatarStatus,
  shape,
  size = "md",
  class: className,
  ...rest
}: PersonCellProps) {
  const avatarSize = size === "sm" ? "sm" : "md";

  const classes = ["pk-person-cell", size === "md" ? null : `pk-person-cell--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={classes} {...rest}>
      <Avatar name={name} src={avatarSrc} size={avatarSize} shape={shape} status={avatarStatus} />
      <div class="pk-person-cell__text">
        <div class="pk-person-cell__name" title={name}>
          {name}
        </div>
        {email ? (
          <div class="pk-person-cell__email" title={email}>
            {email}
          </div>
        ) : detail ? (
          <div class="pk-person-cell__email">{detail}</div>
        ) : null}
      </div>
    </div>
  );
}
