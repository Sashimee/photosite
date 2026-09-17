import { Module } from '@nestjs/common';
import { OpenapiController } from './openapi.controller.js';

@Module({
  controllers: [OpenapiController],
})
export class OpenapiModule {}
