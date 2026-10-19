/**
 * SectionHeading — a heading inside a screen, at the level its outline gives it.
 *
 * `level` is the authored level under the shared convention (see
 * `HeadingOutline`): a screen's title is 2, its sections are 3, and a section
 * inside a section is 4. The surface decides which element that becomes, so
 * the same component is an `<h2>` below the portal's `<h1>`, an `<h3>` inside
 * a dialog, and an `<h3>` on a public page — and never skips a rung because a
 * screen moved to another host.
 *
 * The element follows the outline; the look follows the authored level. A
 * section heading keeps the size it was designed at whichever element it
 * renders as, so moving a screen under a different title does not resize its
 * sections. A class passed in still decides the look over both.
 */
import type { ComponentChildren, JSX } from "preact";

import { useSectionHeading, type HeadingLevel } from "./HeadingOutline";

import "./SectionHeading.css";

export interface SectionHeadingProps extends Omit<JSX.HTMLAttributes<HTMLHeadingElement>, "size"> {
  /** The authored level: 3 for a section of the screen, 4 for a section inside one. */
  level: Exclude<HeadingLevel, 1>;
  children?: ComponentChildren;
}

export function SectionHeading({ level, children, ...rest }: SectionHeadingProps) {
  const Tag = useSectionHeading(level);
  return (
    <Tag data-heading-level={level} {...rest}>
      {children}
    </Tag>
  );
}
