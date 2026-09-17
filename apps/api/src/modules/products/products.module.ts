import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [ProductsController],
  providers: [ProductsService, OriginGuard],
})
export class ProductsModule {}
