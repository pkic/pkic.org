import { render } from "preact";
import { DonationWidget, type DonationWidgetOptions } from "../../site/DonationWidget";
export type { DonationWidgetOptions } from "../../site/DonationWidget";

/**
 * Builds and returns the widget element containing the form and checkout
 * overlay. Call `initDonationForm()` after appending to the DOM.
 */
export function buildDonationWidget(opts: DonationWidgetOptions = {}): HTMLElement {
  const wrapper = document.createElement("div");
  render(<DonationWidget opts={opts} />, wrapper);
  // Return the rendered widget element (first child of the wrapper)
  const widget = wrapper.firstElementChild as HTMLElement;
  if (widget) {
    wrapper.removeChild(widget);
    return widget;
  }
  return wrapper;
}
