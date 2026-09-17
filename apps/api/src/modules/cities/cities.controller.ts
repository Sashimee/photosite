import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { CitiesQuerySchema } from '@photoo/shared';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { CitiesService } from './cities.service.js';

@Controller('cities')
export class CitiesController {
  constructor(@Inject(CitiesService) private readonly cities: CitiesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  async list(
    @Query(new ZodValidationPipe(CitiesQuerySchema))
    query: ReturnType<(typeof CitiesQuerySchema)['parse']>,
  ) {
    return this.cities.list(query);
  }
}
