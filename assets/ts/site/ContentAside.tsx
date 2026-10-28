import type { ComponentChildren } from "preact";
import "./ContentAside.css";

/** Shared markup for the public component and the visual editor's editable node. */
export const CONTENT_ASIDE_ATTRIBUTES = { class: "pk pk-content-aside" };

/** Complementary page content, without the live announcements of an Alert. */
export function ContentAside({ children }: { children?: ComponentChildren }) {
  return <aside {...CONTENT_ASIDE_ATTRIBUTES}>{children}</aside>;
}
