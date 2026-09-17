import { Controller, Get, Header, Inject } from '@nestjs/common';
import { CountriesService } from './countries.service.js';

@Controller('countries')
export class CountriesController {
  constructor(@Inject(CountriesService) private readonly countries: CountriesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  async list() {
    return this.countries.list();
  }
}
