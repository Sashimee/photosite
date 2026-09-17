import { Module } from '@nestjs/common';
import { CountriesController } from './countries.controller.js';
import { CountriesRepository } from './countries.repository.js';
import { CountriesService } from './countries.service.js';

@Module({
  controllers: [CountriesController],
  providers: [CountriesService, CountriesRepository],
})
export class CountriesModule {}
