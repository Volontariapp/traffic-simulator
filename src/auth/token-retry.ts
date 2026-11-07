/** Renouvelle une session expiree : retourne le nouvel access token, ou undefined en cas d'echec. */
export type TokenRefresher = (staleToken: string) => Promise<string | undefined>;

export interface AuthorizedResponse {
  response: Response;
  /** Token effectivement utilise pour la reponse retournee (change si la session a ete renouvelee). */
  token: string;
}

/**
 * Execute une requete authentifiee. Sur un 401, demande un nouveau token via `refresher`
 * et rejoue la requete UNE seule fois. Un second 401 est retourne tel quel (pas de boucle).
 */
export async function fetchWithTokenRetry(
  doFetch: (token: string) => Promise<Response>,
  token: string,
  refresher?: TokenRefresher,
): Promise<AuthorizedResponse> {
  const first = await doFetch(token);
  if (first.status !== 401 || !refresher) {
    return { response: first, token };
  }

  const fresh = await refresher(token);
  if (!fresh || fresh === token) {
    return { response: first, token };
  }

  await first.body?.cancel().catch(() => undefined);
  return { response: await doFetch(fresh), token: fresh };
}
