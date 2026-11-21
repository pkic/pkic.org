/**
 * What an attendance grid shows when attending has a price: content above
 * and below the grid, a price on each option, and a callback with the days
 * chosen. The grid knows nothing about tickets; whoever hosts it supplies
 * this through context, so every place that renders the grid stays the same.
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";

/** What one way of attending costs, shown on its row where the person chooses it. */
export interface AttendanceOptionPrice {
  /** "Free", "$395", or a range such as "Free to $395". */
  amount?: string;
  /** Whether the amount is for the whole event or for each day attended. Left out when there is nothing to pay. */
  per?: "event" | "day";
  /** What the amount covers, in place of the words `per` gives: "by ticket". */
  covers?: string;
  /**
   * Days with a price of their own, by `YYYY-MM-DD`. An amount charged per day is shown
   * on each day, where it is paid; an amount for the event is shown once, on the option.
   */
  byDay?: Readonly<Record<string, string>>;
}

export interface AttendancePricing {
  above?: ComponentChildren;
  below?: ComponentChildren;
  optionPrices?: Readonly<Record<string, AttendanceOptionPrice>>;
  /** What the prices are for, above them: "Vendor ticket". */
  priceHeading?: string;
  onSelection?: (selected: Readonly<Record<string, string>>) => void;
  /** The ticket and what it costs, as the review lists them before the person registers. */
  reviewItems?: readonly { term: string; value: string }[];
  /**
   * Resolves once the latest choice is kept on the server, so a registration is made with what is shown.
   * Rejects when it was not kept, and with `PricingChoiceRequiredError` when there is no choice to keep yet.
   */
  settle?: () => Promise<void>;
}

/** The person still has to choose before the registration can be made. Its message is what they are told. */
export class PricingChoiceRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingChoiceRequiredError";
  }
}

export const AttendancePricingContext = createContext<AttendancePricing | null>(null);

export function useAttendancePricing(): AttendancePricing | null {
  return useContext(AttendancePricingContext);
}
