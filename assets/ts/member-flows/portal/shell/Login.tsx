/**
 * The portal's sign-in screen: the shared sign-in card, told where the
 * interrupted route returns the reader and which flow that route belongs to.
 */
import type { ComponentProps } from "preact";
import { SignInCard } from "../../../components/sign-in/SignInCard";
import { portalMagicLinkReturnPath, portalReturnPath } from "../hash-route";
import { signInDestination } from "./sign-in-destinations";

export function Login(props: Omit<ComponentProps<typeof SignInCard>, "returnPath" | "destination" | "embedded">) {
  const returnPath =
    typeof window === "undefined"
      ? "/portal/"
      : (portalReturnPath(window.location.hash) ?? portalMagicLinkReturnPath(window.location.hash) ?? undefined);
  return <SignInCard {...props} returnPath={returnPath} destination={signInDestination(returnPath)} />;
}
