import { act } from '@testing-library/react-native';
import { jest } from '@jest/globals';
import { AppState, type AppStateStatus } from 'react-native';

type Handler = (...args: never[]) => void;
type AckResponder = (payload: unknown) => unknown;

export function createFakeSocket() {
  const listeners = new Map<string, Set<Handler>>();
  const emitted: { event: string; payload: unknown }[] = [];
  const responders = new Map<string, AckResponder>();

  function dispatch(event: string, payload?: unknown) {
    for (const handler of listeners.get(event) ?? []) {
      (handler as (payload?: unknown) => void)(payload);
    }
  }

  const socket = {
    connected: false,
    on: jest.fn((event: string, handler: Handler) => {
      const set = listeners.get(event) ?? new Set<Handler>();
      set.add(handler);
      listeners.set(event, set);
      return socket;
    }),
    off: jest.fn((event: string, handler: Handler) => {
      listeners.get(event)?.delete(handler);
      return socket;
    }),
    removeAllListeners: jest.fn(() => {
      listeners.clear();
      return socket;
    }),
    connect: jest.fn(() => {
      socket.connected = true;
      dispatch('connect');
      return socket;
    }),
    disconnect: jest.fn(() => {
      if (socket.connected) {
        socket.connected = false;
        dispatch('disconnect', 'io client disconnect');
      }
      return socket;
    }),
    emit: jest.fn((event: string, payload?: unknown) => {
      emitted.push({ event, payload });
      return true;
    }),
    timeout: () => ({
      emitWithAck: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
        const responder = responders.get(event);
        return Promise.resolve(responder ? responder(payload) : { ok: true, data: {} });
      },
    }),
  };

  return {
    socket,
    emitted,
    respondTo(event: string, responder: AckResponder) {
      responders.set(event, responder);
    },
    receive(event: string, payload?: unknown) {
      act(() => {
        dispatch(event, payload);
      });
    },
    emittedEvents(event: string) {
      return emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
    },
    reset() {
      listeners.clear();
      emitted.length = 0;
      responders.clear();
      socket.connected = false;
      socket.on.mockClear();
      socket.off.mockClear();
      socket.removeAllListeners.mockClear();
      socket.connect.mockClear();
      socket.disconnect.mockClear();
      socket.emit.mockClear();
    },
  };
}

export function installAppState() {
  const handlers = new Set<(state: AppStateStatus) => void>();
  Object.assign(AppState, { currentState: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.add(handler);
    return {
      remove: () => {
        handlers.delete(handler);
      },
    };
  });

  return {
    set(state: AppStateStatus) {
      Object.assign(AppState, { currentState: state });
      act(() => {
        for (const handler of handlers) {
          handler(state);
        }
      });
    },
  };
}
