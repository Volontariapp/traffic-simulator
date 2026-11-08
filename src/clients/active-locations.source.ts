import type { ApiClient } from './api-client.js';
import type { GeoPoint } from '../geo/local-area.js';

export type ActiveLocationsApi = Pick<ApiClient, 'login' | 'getActiveUserLocations'>;

export interface ActiveLocationsCredentials {
  email: string;
  password: string;
  maxAgeMinutes: number;
}

/**
 * Lit les positions (cellules de 1 km, anonymes) des vrais utilisateurs qui en ont envoye une
 * recemment. Route reservee aux admins : le compte du simulateur se connecte a chaque lecture
 * (une toutes les 5 minutes), ce qui evite de gerer l'expiration d'un jeton de plus.
 * Leve une erreur si la connexion ou la lecture echoue : l'appelant retombe sur les centres fixes.
 */
export function createActiveLocationsSource(
  api: ActiveLocationsApi,
  credentials: ActiveLocationsCredentials,
): () => Promise<GeoPoint[]> {
  return async () => {
    const session = await api.login({ email: credentials.email, password: credentials.password }, true);
    if (!session.accessToken) {
      throw new Error('connexion admin refusee (identifiants du simulateur ou role ADMIN manquant)');
    }

    const cells = await api.getActiveUserLocations(session.accessToken, credentials.maxAgeMinutes, true);
    if (!cells) {
      throw new Error('lecture des positions actives refusee ou indisponible');
    }
    return cells;
  };
}
