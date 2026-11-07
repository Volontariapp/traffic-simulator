import { randomUUID } from 'node:crypto';

export interface UserAuthCredentials {
  id: string;
  email: string;
  pseudo: string;
  accessToken: string;
  refreshToken?: string;
  role: 'VOLUNTEER' | 'ORGANIZER';
}

export class ApiClient {
  constructor(public readonly baseUrl: string) {}

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    token?: string,
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, status: res.status, error: text };
      }
      if (res.status === 204) {
        return { ok: true, status: res.status };
      }
      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async signUp(userData: {
    email: string;
    pseudo: string;
    password: string;
    bio?: string;
  }): Promise<{ user?: { id: string }; accessToken?: string }> {
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
      };
    }
    return {};
  }

  async login(credentials: {
    email: string;
    password: string;
  }): Promise<{ user?: { id: string }; accessToken?: string }> {
    const res = await this.request<{
      user: { id: string };
      auth: { accessToken: string; refreshToken?: string };
    }>('/users/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });

    if (res.ok && res.data) {
      return {
        user: res.data.user,
        accessToken: res.data.auth?.accessToken,
      };
    }
    return {};
  }

  async createEvent(
    token: string,
    payload: {
      title: string;
      description: string;
      startAt: string;
      endAt: string;
      localisationName: string;
      type: 'EVENT_TYPE_ECOLOGY' | 'EVENT_TYPE_SOCIAL';
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
    newState: 'EVENT_STATE_IN_PROGRESS' | 'EVENT_STATE_FINISHED' | 'EVENT_STATE_CANCELLED',
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

  async participateEvent(token: string, eventId: string): Promise<boolean> {
    const res = await this.request(
      `/social/events/${eventId}/participate`,
      { method: 'POST' },
      token,
    );
    return res.ok;
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
}

