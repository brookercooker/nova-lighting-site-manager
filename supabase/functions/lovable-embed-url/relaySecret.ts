// Server-to-server relay path: only when RELAY_EMBED_SECRET is configured (>= 32 chars).
export function relaySecretMatches(secret: string | undefined, header: string | null): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const a = new TextEncoder().encode(secret);
  const b = new TextEncoder().encode(header);
  // Constant-time over the secret's length; length mismatch still compares fully.
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}
