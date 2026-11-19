/**
 * The portal's sign-in screen: the shared sign-in card, told where the
 * interrupted route returns the reader and which flow that route belongs to.
 */
import type { ComponentProps } from "preact";
import { SignInCard } from "../../../components/sign-in/SignInCard";
import { portalMagicLinkReturnPath, portalReturnPath } from "../hash-route";
import { signInDestination } from "../../../components/sign-in/sign-in-destinations";
import { signInReturnPath } from "../../../shared/query-context";

export function Login(props: Omit<ComponentProps<typeof SignInCard>, "returnPath" | "destination" | "embedded">) {
  const interrupted =
    typeof window === "undefined"
      ? "/portal/"
      : (portalReturnPath(window.location.hash) ?? portalMagicLinkReturnPath(window.location.hash) ?? undefined);
  // An invitation route keeps its token in this browser; the emailed link carries only the invitation id.
  const returnPath = interrupted && signInReturnPath(interrupted);
  return <SignInCard {...props} returnPath={returnPath} destination={signInDestination(returnPath)} />;
}
