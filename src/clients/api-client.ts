import { randomUUID } from 'node:crypto';
import { fetchWithTokenRetry, type TokenRefresher } from '../auth/token-retry.js';
import { EventState, EventType } from '@volontariapp/contracts';

export interface UserAuthCredentials {
  id: string;
  email: string;
  pseudo: string;
  password?: string;
  accessToken: string;
  refreshToken?: string;
  role: 'VOLUNTEER' | 'ORGANIZER';
}

export class ApiClient {
  public readonly baseUrl: string;
  private tokenRefresher?: TokenRefresher;

  /** Branche le renouvellement de session : appele sur toute reponse 401 d'une requete authentifiee. */
  setTokenRefresher(refresher: TokenRefresher): void {
    this.tokenRefresher = refresher;
  }

  /**
   * `extraHeaders` : en-tetes ajoutes a chaque requete (ex. jeton de service Cloudflare Access quand
   * la gateway est jointe par son URL publique). Vide en cluster : l'appel est direct.
   */
  constructor(
    rawBaseUrl: string,
    private readonly extraHeaders: Readonly<Record<string, string>> = {},
  ) {
    const trimmed = rawBaseUrl.replace(/\/+$/, '');
    this.baseUrl = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    token?: string,
    silent = false,
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
    const url = `${this.baseUrl}${endpoint}`;
    const buildHeaders = (bearer?: string): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...(options.headers as Record<string, string>),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    });

    try {
      const res = token
        ? (
            await fetchWithTokenRetry(
              (bearer) => fetch(url, { ...options, headers: buildHeaders(bearer) }),
              token,
              this.tokenRefresher,
            )
          ).response
        : await fetch(url, { ...options, headers: buildHeaders() });
      if (!res.ok) {
        const text = await res.text();
        if (!silent) {
          console.warn(`[ApiClient] ⚠️ ${options.method || 'GET'} ${url} returned ${res.status}: ${text}`);
        }
        return { ok: false, status: res.status, error: text };
      }
      if (res.status === 204) {
        return { ok: true, status: res.status };
      }
      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!silent) {
        console.error(`[ApiClient] 💥 Network/Fetch error on ${options.method || 'GET'} ${url}: ${errMsg}`);
      }
      return { ok: false, status: 0, error: errMsg };
    }
  }

  async signUp(userData: {
    email: string;
    pseudo: string;
    password: string;
    bio?: string;
  }): Promise<{ user?: { id: string }; accessToken?: string; refreshToken?: string }> {
    const res = await this.request<{
      user: { id: string };
      auth: { accessToken: string; refreshToken?: string };
    }>('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });

    if (res.ok && res.data) {
      return {
        user: res.data.user,
        accessToken: res.data.auth?.accessToken,
        refreshToken: res.data.auth?.refreshToken,
      };
    }
    return {};
  }

  extractUserIdFromJwt(token: string): string | undefined {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return undefined;
      const json = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(json) as { id?: string; sub?: string };
      return payload.id || payload.sub;
    } catch {
      return undefined;
    }
  }

  async login(
    credentials: {
      email: string;
      password: string;
    },
    silent = false,
  ): Promise<{ user?: { id: string; pseudo?: string }; accessToken?: string; refreshToken?: string }> {
    const res = await this.request<{
      user?: { id: string; pseudo?: string };
      auth: { accessToken: string; refreshToken?: string };
    }>(
      '/users/login',
      {
        method: 'POST',
        body: JSON.stringify(credentials),
      },
      undefined,
      silent,
    );

    if (res.ok && res.data) {
      const accessToken = res.data.auth?.accessToken;
      let userId = res.data.user?.id;
      if (!userId && accessToken) {
        userId = this.extractUserIdFromJwt(accessToken);
      }
      return {
        user: userId ? { id: userId, pseudo: res.data.user?.pseudo } : undefined,
        accessToken,
        refreshToken: res.data.auth?.refreshToken,
      };
    }
    return {};
  }

  /**
   * Echange un refresh token contre une nouvelle paire de tokens.
   * La gateway lit le refresh token dans le header Authorization (RefreshTokenMiddleware), le body
   * ne sert qu'a la commande : les deux sont requis. Pas de `token` ici : un 401 ne doit pas
   * declencher le renouvellement d'un access token.
   */
  async refreshSession(
    refreshToken: string,
    silent = true,
  ): Promise<{ accessToken?: string; refreshToken?: string }> {
    const res = await this.request<{ auth?: { accessToken: string; refreshToken?: string } }>(
      '/users/refresh',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${refreshToken}` },
        body: JSON.stringify({ refreshToken }),
      },
      undefined,
      silent,
    );
    if (res.ok && res.data?.auth?.accessToken) {
      return { accessToken: res.data.auth.accessToken, refreshToken: res.data.auth.refreshToken };
    }
    return {};
  }

  /** Lit le pseudo courant de l'utilisateur authentifie (lecture seule, sans evenement). */
  async getMyPseudo(token: string): Promise<string | undefined> {
    const res = await this.request<{ user?: { pseudo?: string } }>(
      '/users/me',
      { method: 'GET' },
      token,
      true,
    );
    return res.ok ? res.data?.user?.pseudo : undefined;
  }

  /** Met a jour le profil de l'utilisateur authentifie (pseudo, bio). */
  async updateMe(
    token: string,
    patch: { pseudo?: string; bio?: string },
    silent = false,
  ): Promise<boolean> {
    const res = await this.request(
      '/users/me',
      { method: 'PATCH', body: JSON.stringify(patch) },
      token,
      silent,
    );
    return res.ok;
  }

  /**
   * Cellules de 1 km (anonymes) des utilisateurs qui ont envoye une position recemment.
   * Route admin : le token doit etre celui d'un compte ADMIN. undefined si refus ou erreur.
   */
  async getActiveUserLocations(
    token: string,
    maxAgeMinutes: number,
    silent = false,
  ): Promise<Array<{ lat: number; lng: number }> | undefined> {
    const q = new URLSearchParams({ maxAgeMinutes: String(maxAgeMinutes) });
    const res = await this.request<{ cells?: Array<{ lat: number; lng: number }> }>(
      `/ranking/admin/active-locations?${q.toString()}`,
      { method: 'GET' },
      token,
      silent,
    );
    return res.ok ? (res.data?.cells ?? []) : undefined;
  }

  /**
   * Suit un utilisateur. 409 (relation deja presente) n'est pas une erreur : 'exists', ce qui rend
   * un rejeu complet du plan inoffensif.
   */
  async followUser(token: string, userId: string): Promise<'created' | 'exists' | 'failed'> {
    const res = await this.request(`/social/follow/${userId}`, { method: 'POST' }, token, true);
    if (res.ok) return 'created';
    return res.status === 409 ? 'exists' : 'failed';
  }

  /** Ne plus suivre `userId`. 404 (relation absente) compte comme fait : le nettoyage se rejoue. */
  async unfollowUser(token: string, userId: string): Promise<boolean> {
    const res = await this.request(`/social/follow/${userId}`, { method: 'DELETE' }, token, true);
    return res.ok || res.status === 404;
  }

  /** Identifiants des comptes suivis par le compte authentifie (une page). undefined si echec. */
  async listMyFollowIds(token: string, limit = 100): Promise<string[] | undefined> {
    const q = `pagination[page]=1&pagination[limit]=${limit}`;
    const res = await this.request<{ users?: Array<{ id?: string }> }>(
      `/social/follows?${q}`,
      { method: 'GET' },
      token,
      true,
    );
    if (!res.ok) return undefined;
    return (res.data?.users ?? []).flatMap((user) => (user.id ? [user.id] : []));
  }

  /** Souhaite un event. 409 (deja souhaite) n'est pas une erreur. */
  async wishEvent(token: string, eventId: string): Promise<'created' | 'exists' | 'failed'> {
    const res = await this.request(`/social/events/${eventId}/wish`, { method: 'POST' }, token, true);
    if (res.ok) return 'created';
    return res.status === 409 ? 'exists' : 'failed';
  }

  /** Retire un souhait. 404 (absent) compte comme fait. */
  async unwishEvent(token: string, eventId: string): Promise<boolean> {
    const res = await this.request(`/social/events/${eventId}/wish`, { method: 'DELETE' }, token, true);
    return res.ok || res.status === 404;
  }

  /** Quitte un event. 404 (participation absente) compte comme fait. */
  async unparticipateEvent(token: string, eventId: string): Promise<boolean> {
    const res = await this.request(`/social/events/${eventId}/participate`, { method: 'DELETE' }, token, true);
    return res.ok || res.status === 404;
  }

  /**
   * Identifiants des events crees, rejoints ou souhaites par le compte authentifie, lus dans le
   * graphe social (aucun filtre d'etat : un event DRAFT y figure). undefined si echec.
   */
  async listMySocialEventIds(
    token: string,
    list: 'created' | 'participated' | 'wished',
    limit = 100,
  ): Promise<string[] | undefined> {
    const res = await this.request<{ ids?: string[] }>(
      `/social/events/${list}?pagination[page]=1&pagination[limit]=${limit}`,
      { method: 'GET' },
      token,
      true,
    );
    return res.ok ? (res.data?.ids ?? []) : undefined;
  }

  /** Titre d'un event, lu par son organisateur (brouillon compris). undefined si absent ou refus. */
  async getEventTitle(token: string, eventId: string): Promise<string | undefined> {
    const res = await this.request<{ event?: { title?: string } }>(`/events/${eventId}`, { method: 'GET' }, token, true);
    return res.ok ? res.data?.event?.title : undefined;
  }

  /** Le noeud social de l'event existe-t-il (cree en asynchrone apres la creation) ? */
  async eventNodeExists(token: string, eventId: string): Promise<boolean> {
    const res = await this.request(`/social/events/${eventId}`, { method: 'GET' }, token, true);
    return res.ok;
  }

  /** Le compte authentifie suit-il `userId` ? undefined si la lecture echoue. */
  async isFollowing(token: string, userId: string): Promise<boolean | undefined> {
    const res = await this.request<{ isFollowing?: boolean }>(
      `/social/users/${userId}/is-following`,
      { method: 'GET' },
      token,
      true,
    );
    return res.ok ? Boolean(res.data?.isFollowing) : undefined;
  }

  /**
   * Une page de la liste admin des utilisateurs (role ADMIN requis). undefined si refus ou erreur.
   * Aucun ordre ni date de creation n'est garanti : l'appelant parcourt tout et compare.
   */
  async listUsers(
    token: string,
    page: number,
    limit: number,
  ): Promise<Array<{ id: string; email?: string; pseudo?: string; role?: string }> | undefined> {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    const res = await this.request<{ users?: Array<{ id: string; email?: string; pseudo?: string; role?: string }> }>(
      `/users?${q.toString()}`,
      { method: 'GET' },
      token,
      true,
    );
    return res.ok ? (res.data?.users ?? []) : undefined;
  }

  async createEvent(
    token: string,
    payload: {
      title: string;
      description: string;
      startAt: string;
      endAt: string;
      localisationName: string;
      type: EventType | 'EVENT_TYPE_ECOLOGY' | 'EVENT_TYPE_SOCIAL';
      maxParticipants: number;
      coverFileId?: string;
    },
  ): Promise<string | undefined> {
    const res = await this.request<{ event: { id: string } }>(
      '/events',
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          idempotencyKey: randomUUID(),
          tagIds: [],
        }),
      },
      token,
    );

    return res.data?.event?.id;
  }

  async changeEventState(
    token: string,
    eventId: string,
    newState: EventState | 'EVENT_STATE_IN_PROGRESS' | 'EVENT_STATE_FINISHED' | 'EVENT_STATE_CANCELLED',
  ): Promise<boolean> {
    const res = await this.request(
      `/events/${eventId}/state`,
      {
        method: 'PATCH',
        body: JSON.stringify({ newState }),
      },
      token,
    );
    return res.ok;
  }

  async deleteEvent(token: string, eventId: string): Promise<boolean> {
    const res = await this.request(`/events/${eventId}`, { method: 'DELETE' }, token);
    return res.ok;
  }

  async participateEvent(token: string, eventId: string, silent = false): Promise<boolean> {
    const res = await this.request(
      `/social/events/${eventId}/participate`,
      { method: 'POST' },
      token,
      silent,
    );
    return res.ok;
  }

  async setEventAttendance(
    token: string,
    eventId: string,
    checkedUserIds: string[],
    uncheckedUserIds: string[] = [],
    silent = false,
  ): Promise<boolean> {
    const res = await this.request(
      `/social/events/${eventId}/attendance`,
      {
        method: 'POST',
        body: JSON.stringify({
          checkedUserIds,
          uncheckedUserIds,
        }),
      },
      token,
      silent,
    );
    return res.ok;
  }

  async getEventParticipants(
    token: string,
    eventId: string,
    silent = false,
  ): Promise<string[]> {
    const res = await this.request<{ ids?: string[] }>(
      `/social/events/${eventId}/participants`,
      { method: 'GET' },
      token,
      silent,
    );
    return res.data?.ids ?? [];
  }

  async getEventAttendees(
    token: string,
    eventId: string,
    silent = false,
  ): Promise<Array<{ userId: string; checkedInAt?: string | null }>> {
    const res = await this.request<{ attendees?: Array<{ userId: string; checkedInAt?: string | null }> }>(
      `/social/events/${eventId}/attendees`,
      { method: 'GET' },
      token,
      silent,
    );
    return res.data?.attendees ?? [];
  }

  async createPost(
    token: string,
    payload: {
      title: string;
      content: string;
      eventId?: string;
      fileIds?: string[];
    },
  ): Promise<string | undefined> {
    const res = await this.request<{ id: string; post?: { id: string } }>(
      '/posts',
      {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          content: payload.content,
          eventId: payload.eventId,
          fileIds: payload.fileIds ?? [],
          idempotencyKey: randomUUID(),
        }),
      },
      token,
    );

    return res.data?.id ?? res.data?.post?.id;
  }

  async likePost(token: string, postId: string, silent = false): Promise<boolean> {
    const res = await this.request(`/social/likes/${postId}`, { method: 'POST' }, token, silent);
    return res.ok;
  }

  async listEvents(
    token?: string,
    params?: {
      page?: number;
      limit?: number;
      onlyAvailable?: boolean;
    },
    silent = false,
  ): Promise<
    Array<{
      id: string;
      title: string;
      description: string;
      organizerId?: string;
      maxParticipants: number;
      currentParticipants: number;
      state?: string;
      startAt?: string;
      endAt?: string;
      localisationName?: string;
    }>
  > {
    const q = new URLSearchParams({
      page: String(params?.page ?? 1),
      limit: String(params?.limit ?? 50),
    });
    if (params?.onlyAvailable !== undefined) {
      q.set('onlyAvailable', String(params.onlyAvailable));
    }
    const res = await this.request<{
      events?: Array<any>;
      items?: Array<any>;
    }>(`/events?${q.toString()}`, { method: 'GET' }, token, silent);

    return res.data?.events ?? res.data?.items ?? [];
  }

  async listPosts(
    token?: string,
    params?: {
      page?: number;
      limit?: number;
    },
    silent = false,
  ): Promise<
    Array<{
      id: string;
      title: string;
      content: string;
      authorId?: string;
      userId?: string;
      eventId?: string;
      createdAt?: string;
    }>
  > {
    const q = new URLSearchParams({
      page: String(params?.page ?? 1),
      limit: String(params?.limit ?? 50),
    });
    const res = await this.request<{
      posts?: Array<any>;
      items?: Array<any>;
    }>(`/posts?${q.toString()}`, { method: 'GET' }, token, silent);

    return res.data?.posts ?? res.data?.items ?? [];
  }

  async createComment(
    token: string,
    postId: string,
    content: string,
    silent = false,
  ): Promise<boolean> {
    const res = await this.request(
      `/posts/${postId}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      },
      token,
      silent,
    );
    return res.ok;
  }
}

