import type { JSX } from "preact";

import { Avatar } from "./Avatar";
import "./PersonCell.css";

export type PersonCellSize = "sm" | "md";

export interface PersonCellProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "size"> {
  name: string;
  email?: string;
  avatarSrc?: string;
  size?: PersonCellSize;
}

export function PersonCell({ name, email, avatarSrc, size = "md", class: className, ...rest }: PersonCellProps) {
  const avatarSize = size === "sm" ? "sm" : "md";

  const classes = ["pk-person-cell", size === "md" ? null : `pk-person-cell--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={classes} {...rest}>
      <Avatar name={name} src={avatarSrc} size={avatarSize} />
      <div class="pk-person-cell__text">
        <div class="pk-person-cell__name">{name}</div>
        {email && <div class="pk-person-cell__email">{email}</div>}
      </div>
    </div>
  );
}
