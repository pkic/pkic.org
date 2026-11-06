/**
 * The conference kit's field gradient. The attendee event app paints its key
 * visual with it and the agenda's session dialog paints its header with it, so
 * both tokens read this one definition.
 */
export const conferenceFieldColors = { darkGreen: "#0b2a1c", green: "#125c3c", blue: "#20506e", orange: "#b0581f" };
export const conferenceFieldStops = `${conferenceFieldColors.darkGreen} 0%, ${conferenceFieldColors.green} 32%, ${conferenceFieldColors.blue} 74%, ${conferenceFieldColors.orange} 100%`;
export const conferenceField = `linear-gradient(135deg, ${conferenceFieldStops})`;
