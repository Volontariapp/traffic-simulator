import { io } from 'socket.io-client';
import type { ProbeSocketFactory } from './async-probe.js';

/**
 * Sockets de la sonde, ouverts comme nativapp (src/services/socket.service.ts) : chemin
 * `/api/v1/socket.io` de la gateway, jeton en query et en Authorization, transport websocket,
 * plus le jeton Cloudflare Access de la rampe.
 */
export function createProbeSocketFactory(
  apiBaseUrl: string,
  extraHeaders: Readonly<Record<string, string>>,
): ProbeSocketFactory {
  const origin = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return (token) => {
    const socket = io(origin, {
      path: '/api/v1/socket.io',
      query: { token },
      extraHeaders: { ...extraHeaders, Authorization: `Bearer ${token}` },
      transports: ['websocket'],
    });
    return {
      on: (event, handler) => {
        socket.on(event, handler);
      },
      close: () => {
        socket.close();
      },
    };
  };
}
