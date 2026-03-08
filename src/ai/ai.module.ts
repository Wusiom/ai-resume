import { Module } from '@nestjs/common';
import { AIModelFactory } from './services/ai-model.factory';
import { SessionManager } from './services/session.manager';

@Module({
  providers: [AIModelFactory, SessionManager],
  exports: [AIModelFactory, SessionManager],
})
export class AIModule {}
