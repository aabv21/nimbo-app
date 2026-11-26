// Hex colour helpers: the design's `color-mix()` tones, computed once from the theme tokens.

/** The 0..1 sRGB channels of a `#rrggbb` colour. */
export function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }
  const [, r = '', g = '', b = ''] = match;
  return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255];
}

function toHex(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/** `color-mix(in srgb, a <weight>, b)`: `weight` of `a`, the rest of `b`. */
export function mix(a: string, b: string, weight: number): string {
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  const blend = (x: number, y: number): string => toHex(x * weight + y * (1 - weight));
  return `#${blend(r1, r2)}${blend(g1, g2)}${blend(b1, b2)}`;
}

/** `color-mix(in srgb, hex <opacity>, transparent)`, as `#rrggbbaa`. */
export function alpha(hex: string, opacity: number): string {
  channels(hex);
  return `${hex}${toHex(opacity)}`;
}
