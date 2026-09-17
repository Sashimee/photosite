import type { Provider } from '@nestjs/common';

export type ChatClock = () => number;

export const CHAT_CLOCK = Symbol('CHAT_CLOCK');

export const chatClockProvider: Provider = {
  provide: CHAT_CLOCK,
  useValue: (): number => Date.now(),
};
