import { createContext } from "preact";

/**
 * Whether the pictures of an output drawn inside cut between states: a
 * scene's thumbnail, and every monitor on a phone, where a graphic playing
 * its way on or off costs the browser more memory than it has. Such a
 * picture shows each state at once, so a graphic never waits for motion
 * that does not play. What keeps moving in it, and how, is the stylesheet's
 * (see StudioPhone.css).
 */
export const LiveStillPictures = createContext(false);
