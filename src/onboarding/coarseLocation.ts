// The rough area for weather: asked once in onboarding, rounded on the phone before it is ever sent.
import * as Location from 'expo-location';

/** One decimal of a degree, about 11 km: enough for a pressure forecast, never a street. */
export function toCoarse(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 };
}

/** Asks for the foreground permission and reads the lowest-accuracy fix; null when denied or unreadable. */
export async function captureCoarseLocation(): Promise<{ lat: number; lon: number } | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
    return toCoarse(position.coords.latitude, position.coords.longitude);
  } catch {
    // Location services off or no fix: the step is optional, so it moves on without an area.
    return null;
  }
}
