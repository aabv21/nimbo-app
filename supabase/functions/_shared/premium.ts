// The server-side premium check for Edge Functions: pass the caller's own client (it may only ask about its user)
// or a service-role one. Runtime-neutral, so a test loads it without Deno.

export interface PremiumClient {
  rpc(name: 'has_premium', args: { p_user: string }): PromiseLike<{ data: boolean | null; error: unknown }>;
}

/** True only on a clear yes: an error, a null or a thrown call all count as not premium. */
export async function hasPremium(client: PremiumClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('has_premium', { p_user: userId });
    return error === null || error === undefined ? data === true : false;
  } catch {
    return false;
  }
}
