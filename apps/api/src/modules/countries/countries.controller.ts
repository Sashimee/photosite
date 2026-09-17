import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { CountryCodeSchema } from '@photoo/shared';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CountriesService } from './countries.service.js';

@Controller('countries')
export class CountriesController {
  constructor(@Inject(CountriesService) private readonly countries: CountriesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  async list() {
    return this.countries.list();
  }

  @Get(':code/verification-requirements')
  @Header('Cache-Control', 'public, max-age=3600')
  async getVerificationRequirements(
    @Param('code', new ZodValidationPipe(CountryCodeSchema)) code: string,
  ) {
    return this.countries.getVerificationRequirements(code);
  }
}
