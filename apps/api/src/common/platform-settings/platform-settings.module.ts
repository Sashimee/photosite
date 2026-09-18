import { Global, Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service.js';

@Global()
@Module({
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
