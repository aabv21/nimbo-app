// The signed-in user outside React, for work that settles after the screen that started it has gone.

let current: string | null = null;

/** The account `AuthProvider` last reported; null when signed out. */
export function currentUserId(): string | null {
  return current;
}

/** Only `AuthProvider` (and its test stand-in) calls this. */
export function setCurrentUserId(userId: string | null): void {
  current = userId;
}
