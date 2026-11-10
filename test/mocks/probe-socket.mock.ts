import { mock } from 'node:test';
import type { ProbeSocket, ProbeSocketFactory } from '../../src/load/probe/async-probe.js';

/** Sockets simules : `emit(token, event, payload)` delivre un message au socket ouvert avec ce jeton. */
export function createProbeSocketMock() {
  const handlers = new Map<string, Map<string, (payload: unknown) => void>>();
  const close = mock.fn(() => undefined);
  const factory = mock.fn<ProbeSocketFactory>((token) => {
    const byEvent = new Map<string, (payload: unknown) => void>();
    handlers.set(token, byEvent);
    const socket: ProbeSocket = {
      on: (event, handler) => {
        byEvent.set(event, handler);
      },
      close,
    };
    return socket;
  });
  const emit = (token: string, event: string, payload: unknown): void => {
    handlers.get(token)?.get(event)?.(payload);
  };
  return { factory, emit, close };
}
