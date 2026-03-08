import { Module } from '@nestjs/common';
import { InterviewController } from './interview.controller';
import { InterviewService } from './services/interview.service';
import { ConfigModule } from '@nestjs/config';
import { AIModule } from '../ai/ai.module';
import { ConversationContinuationService } from './services/conversation-continuation.service';
import { ResumeAnalysisService } from './services/resume-analysis.service';
@Module({
  imports: [
    ConfigModule,
    AIModule,
    // MongooseModule.forFeature([...]),
  ],
  controllers: [InterviewController],
  providers: [
    InterviewService,
    ConversationContinuationService,
    ResumeAnalysisService,
  ],
  exports: [InterviewService],
})
export class InterviewModule {}
