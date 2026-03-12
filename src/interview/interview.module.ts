import { Module } from '@nestjs/common';
import { InterviewController } from './interview.controller';
import { InterviewService } from './services/interview.service';
import { ConfigModule } from '@nestjs/config';
import { AIModule } from '../ai/ai.module';
import { ConversationContinuationService } from './services/conversation-continuation.service';
import { ResumeAnalysisService } from './services/resume-analysis.service';
import { DocumentParserService } from './services/document-parser.service';
import { InterviewAIService } from './services/interview-ai.service';

import { MongooseModule } from '@nestjs/mongoose';

import {
  ConsumptionRecordSchema,
  ConsumptionRecord,
} from './schemas/consumption-record.schema';
import {
  ResumeQuizResult,
  ResumeQuizResultSchema,
} from './schemas/interview-quiz-result.schema';
import { User, UserSchema } from '../user/schemas/user.schema';
@Module({
  imports: [
    ConfigModule,
    AIModule,
    MongooseModule.forFeature([
      { name: ConsumptionRecord.name, schema: ConsumptionRecordSchema },
      { name: ResumeQuizResult.name, schema: ResumeQuizResultSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [InterviewController],
  providers: [
    InterviewService,
    ConversationContinuationService,
    ResumeAnalysisService,
    DocumentParserService,
    InterviewAIService,
  ],
  exports: [InterviewService],
})
export class InterviewModule {}
