import { Inject, Injectable, type Provider } from '@nestjs/common';
import type { Quote } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface QuoteEvents {
  onCreated(quote: Quote): Promise<void> | void;
  onAccepted(quote: Quote): Promise<void> | void;
  onDeclined(quote: Quote): Promise<void> | void;
  onWithdrawn(quote: Quote): Promise<void> | void;
}

export const QUOTE_EVENTS = Symbol('QUOTE_EVENTS');

@Injectable()
export class NotificationQuoteEvents implements QuoteEvents {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async onCreated(quote: Quote): Promise<void> {
    const [profile, requestTitle] = await Promise.all([
      this.loadProfile(quote.photographerId),
      this.loadRequestTitle(quote.requestId),
    ]);
    await this.notifications.notify(quote.clientId, 'quote_received', {
      quoteId: quote.id,
      requestId: quote.requestId ?? undefined,
      requestTitle,
      total: { amountCents: quote.totalCents, currency: quote.currency },
      counterpartName: profile?.displayName,
    });
  }

  async onAccepted(quote: Quote): Promise<void> {
    await this.notifyPhotographer(quote, 'quote_accepted');
  }

  async onDeclined(quote: Quote): Promise<void> {
    await this.notifyPhotographer(quote, 'quote_declined');
  }

  async onWithdrawn(quote: Quote): Promise<void> {
    const [profile, requestTitle] = await Promise.all([
      this.loadProfile(quote.photographerId),
      this.loadRequestTitle(quote.requestId),
    ]);
    await this.notifications.notify(quote.clientId, 'quote_withdrawn', {
      quoteId: quote.id,
      requestId: quote.requestId ?? undefined,
      requestTitle,
      total: { amountCents: quote.totalCents, currency: quote.currency },
      counterpartName: profile?.displayName,
    });
  }

  // The photographer is notified on their own account, not their profile,
  // so the profile lookup only resolves the userId and the display name of
  // the counterpart shown to them is the client's.
  private async notifyPhotographer(
    quote: Quote,
    type: 'quote_accepted' | 'quote_declined',
  ): Promise<void> {
    const [profile, client, requestTitle] = await Promise.all([
      this.loadProfile(quote.photographerId),
      this.prisma.client.user.findUnique({ where: { id: quote.clientId } }),
      this.loadRequestTitle(quote.requestId),
    ]);
    if (!profile) {
      return;
    }
    await this.notifications.notify(profile.userId, type, {
      quoteId: quote.id,
      requestId: quote.requestId ?? undefined,
      requestTitle,
      total: { amountCents: quote.totalCents, currency: quote.currency },
      counterpartName: client?.name ?? undefined,
    });
  }

  private loadProfile(photographerId: string) {
    return this.prisma.client.photographerProfile.findUnique({ where: { id: photographerId } });
  }

  private async loadRequestTitle(requestId: string | null): Promise<string | undefined> {
    if (!requestId) {
      return undefined;
    }
    const request = await this.prisma.client.request.findUnique({ where: { id: requestId } });
    return request?.title;
  }
}

export const quoteEventsProvider: Provider = {
  provide: QUOTE_EVENTS,
  useClass: NotificationQuoteEvents,
};
