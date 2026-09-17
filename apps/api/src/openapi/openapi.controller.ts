import { Controller, Get } from '@nestjs/common';
import { buildOpenApiDocument } from '@photoo/shared';

@Controller()
export class OpenapiController {
  @Get('openapi.json')
  getDocument(): ReturnType<typeof buildOpenApiDocument> {
    return buildOpenApiDocument();
  }
}
