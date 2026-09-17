import { Injectable, type Provider } from '@nestjs/common';
import type { Quote } from '@photoo/db';

export interface QuoteEvents {
  onCreated(quote: Quote): Promise<void> | void;
  onAccepted(quote: Quote): Promise<void> | void;
  onDeclined(quote: Quote): Promise<void> | void;
  onWithdrawn(quote: Quote): Promise<void> | void;
}

export const QUOTE_EVENTS = Symbol('QUOTE_EVENTS');

@Injectable()
export class NoopQuoteEvents implements QuoteEvents {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onCreated(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onAccepted(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onDeclined(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onWithdrawn(): void {}
}

export const quoteEventsProvider: Provider = {
  provide: QUOTE_EVENTS,
  useClass: NoopQuoteEvents,
};
