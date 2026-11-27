// How far past the clock a logged time may be, shared by the phone's stores and the companion's drafts.

/** The stores refuse a later time, so a draft that late could never be confirmed; the server clamps up to a day. */
export const MAX_AHEAD_MS = 5 * 60_000;
