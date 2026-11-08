/**
 * Lit le claim `exp` (epoch en secondes) d'un JWT et le renvoie en millisecondes.
 * Pas de verification de signature : le simulateur ne fait que planifier le renouvellement.
 * Undefined si le token n'est pas un JWT lisible.
 */
export function getJwtExpiryMs(token: string): number | undefined {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Vrai si le token expire dans moins de `marginMs` (ou est deja expire). Faux si son exp est illisible. */
export function isExpiringWithin(token: string, marginMs: number, now: number = Date.now()): boolean {
  const expiresAt = getJwtExpiryMs(token);
  return expiresAt !== undefined && expiresAt - now <= marginMs;
}
