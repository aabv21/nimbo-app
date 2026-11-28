/** The device's local calendar day as `YYYY-MM-DD`: a check-in's `local_date`, not the UTC date. */
export function localDate(now: Date = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The device's IANA zone, read at each call so a trip moves it: the one place the app asks for it. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
