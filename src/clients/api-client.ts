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

  constructor(rawBaseUrl: string) {
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

  async likePost(token: string, postId: string): Promise<boolean> {
    const res = await this.request(`/social/likes/${postId}`, { method: 'POST' }, token);
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

