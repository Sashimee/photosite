import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminCountriesController } from './admin-countries.controller.js';
import { AdminCountriesService } from './admin-countries.service.js';
import { CountriesController, PolicyVersionController } from './countries.controller.js';
import { CountriesRepository } from './countries.repository.js';
import { CountriesService } from './countries.service.js';

@Module({
  imports: [AdminModule],
  controllers: [CountriesController, PolicyVersionController, AdminCountriesController],
  providers: [CountriesService, CountriesRepository, AdminCountriesService, OriginGuard],
  exports: [CountriesService],
})
export class CountriesModule {}
