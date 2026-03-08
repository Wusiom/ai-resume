import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationContinuationService } from './conversation-continuation.service';
import { ResumeAnalysisService } from './resume-analysis.service';
import { RESUME_ANALYSIS_SYSTEM_MESSAGE } from '../prompts/resume-quiz.prompts';
import { SessionManager } from 'src/ai/services/session.manager';
@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);
  constructor(
    private configService: ConfigService,
    private sessionManager: SessionManager,
    private resumeAnalysisService: ResumeAnalysisService,
    private conversationContinuationService: ConversationContinuationService,
  ) {}

  async analyzeResume(
    userId: string,
    position: string,
    resumeContent: string,
    jobDescription: string,
  ) {
    try {
      // 1.创建新会话
      const systemMessage = RESUME_ANALYSIS_SYSTEM_MESSAGE(position);
      const sessionId = this.sessionManager.createSession(
        userId,
        position,
        systemMessage,
      );
      this.logger.log(`创建会话: ${sessionId}`);

      // 2.调用专门的简历分析服务
      const result = await this.resumeAnalysisService.analyze(
        resumeContent,
        jobDescription,
      );

      // 3.保存用户输入到会话历史
      this.sessionManager.addMessage(
        sessionId,
        'user',
        `简历内容: ${resumeContent}`,
      );

      // 4.保存AI的回答到会话历史
      this.sessionManager.addMessage(
        sessionId,
        'assistant',
        JSON.stringify(result),
      );
      this.logger.log(`简历分析完成，sessionId: ${sessionId}`);

      return {
        sessionId,
        analysis: result,
      };
    } catch (error) {
      this.logger.error(`分析简历失败：${error}`);
      throw error;
    }
  }

  // 继续对话(多轮， 基于现有会话)
  async continueConversation(
    sessionId: string,
    userQuestion: string,
  ): Promise<string> {
    // 1.添加用户问题到会话历史
    this.sessionManager.addMessage(sessionId, 'user', userQuestion);
    // 2.获取对话历史
    const history = this.sessionManager.getRecentMessages(sessionId, 10);

    this.logger.log(
      `继续对话, sessionId: ${sessionId}, 历史消息数: ${history.length}`,
    );
    // 3.调用专门的对话继续服务
    const aiResponse =
      await this.conversationContinuationService.continue(history);

    // 4.保存AI的回答到会话历史
    this.sessionManager.addMessage(sessionId, 'assistant', aiResponse);

    this.logger.log(`对话继续完成, sessionId: ${sessionId}`);

    return aiResponse;
  }
  catch(error) {
    this.logger.error(`继续对话失败：${error}`);
    throw error;
  }
}
