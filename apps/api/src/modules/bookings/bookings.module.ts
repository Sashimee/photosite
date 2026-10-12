import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, OriginGuard],
})
export class BookingsModule {}
