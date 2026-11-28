/** The device's local calendar day as `YYYY-MM-DD`: a check-in's `local_date`, not the UTC date. */
export function localDate(now: Date = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
