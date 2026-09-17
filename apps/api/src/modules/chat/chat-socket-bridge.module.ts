import { Global, Module } from '@nestjs/common';
import { ChatSocketBridge } from './chat-socket-bridge.js';

@Global()
@Module({
  providers: [ChatSocketBridge],
  exports: [ChatSocketBridge],
})
export class ChatSocketBridgeModule {}
