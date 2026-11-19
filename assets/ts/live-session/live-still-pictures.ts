import { createContext } from "preact";

/**
 * Whether the pictures of an output drawn inside hold still: a scene's
 * thumbnail, and every monitor on a phone, where a moving graphic costs the
 * browser more memory than it has. A still picture shows each state at once,
 * as a cut, so a graphic never waits for motion that does not play.
 */
export const LiveStillPictures = createContext(false);
