import { Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { getRawBody } from '../../bootstrap/raw-body.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { STRIPE_GATEWAY, type GatewayEvent, type StripeGateway } from './stripe/stripe-gateway.js';

function invalidSignature(): HttpException {
  return new HttpException({ code: 'BAD_REQUEST', message: 'Invalid Stripe signature' }, 400);
}

// Authenticated by the Stripe signature alone: no session and no OriginGuard,
// because Stripe calls it server to server.
@Controller('stripe')
export class StripeWebhookController {
  constructor(
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(StripeWebhookService) private readonly webhooks: StripeWebhookService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @HttpCode(200)
  @Post('webhook')
  async receive(@Req() request: FastifyRequest): Promise<{ received: true }> {
    const rawBody = getRawBody(request);
    if (!rawBody) {
      throw new Error(
        'stripe webhook: raw body was not captured; check captureRawBodyOn(STRIPE_WEBHOOK_PATH) in configure-app.ts',
      );
    }
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length === 0) {
      throw invalidSignature();
    }
    let event: GatewayEvent;
    try {
      event = this.gateway.constructWebhookEvent(rawBody, signature);
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.name : 'unknown' },
        'stripe webhook: signature verification failed',
      );
      throw invalidSignature();
    }
    await this.webhooks.receive(event);
    return { received: true };
  }
}
