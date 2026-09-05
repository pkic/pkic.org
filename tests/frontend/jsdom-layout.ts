/**
 * The layout methods jsdom leaves unimplemented.
 *
 * jsdom has no layout engine, so it omits the scrolling methods every browser
 * provides. Code that calls one is correct; the environment running it is the
 * thing that is short. Without these, a component that scrolls after a timeout
 * throws `scrollIntoView is not a function` — and because the throw lands in a
 * timer callback rather than a test body, it escapes as an unhandled error and
 * fails the whole run while every test still reports as passing.
 *
 * Setup runs for every file in the suite, including the SSR tests that render
 * in node and have no DOM at all, so there is nothing to patch there.
 */
if (typeof globalThis.window !== "undefined") {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }

  if (typeof window.scrollTo !== "function") {
    window.scrollTo = function scrollTo() {};
  }
}
