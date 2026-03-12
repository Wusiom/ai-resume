import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationContinuationService } from './conversation-continuation.service';
import { ResumeAnalysisService } from './resume-analysis.service';
import { DocumentParserService } from './document-parser.service';
import { InterviewAIService } from './interview-ai.service';

import { RESUME_ANALYSIS_SYSTEM_MESSAGE } from '../prompts/resume-quiz.prompts';
import { SessionManager } from 'src/ai/services/session.manager';
import { ResumeQuizDto } from '../dto/resume-quiz.dto';
import { Subject } from 'rxjs';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import {
  ConsumptionRecord,
  ConsumptionRecordDocument,
  ConsumptionStatus,
  ConsumptionType,
} from '../schemas/consumption-record.schema';
import { Model } from 'mongoose';
import {
  ResumeQuizResult,
  ResumeQuizResultDocument,
} from '../schemas/interview-quiz-result.schema';
import { UserDocument, User } from 'src/user/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';
// 进度事件
export interface ProgressEvent {
  type: 'progress' | 'complete' | 'error' | 'timeout';
  step?: number;
  label?: string;
  progress: number; //0-100
  message?: string;
  data?: any;
  error?: string;
  stage?: 'prepare' | 'generating' | 'saving' | 'done'; // 当前阶段
}

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);
  constructor(
    private configService: ConfigService,
    private sessionManager: SessionManager,
    private resumeAnalysisService: ResumeAnalysisService,
    private conversationContinuationService: ConversationContinuationService,
    private documentParserService: DocumentParserService,
    private aiService: InterviewAIService,
    @InjectModel(ConsumptionRecord.name)
    private consumptionRecordModel: Model<ConsumptionRecordDocument>,
    @InjectModel(ResumeQuizResult.name)
    private resumeQuizResultModel: Model<ResumeQuizResultDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
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

  // 生成简历押题（带流式进度）
  generateResumeQuizWithProgress(
    userId: string,
    dto: ResumeQuizDto,
  ): Subject<ProgressEvent> {
    const subject = new Subject<ProgressEvent>();

    // 异步执行, 通过 Subject 发送进度
    this.executeResumeQuiz(userId, dto, subject).catch((error) => {
      subject.error(error);
    });
    return subject;
  }

  // 执行简历押题(核心业务逻辑)
  private async executeResumeQuiz(
    userId: string,
    dto: ResumeQuizDto,
    progressSubject?: Subject<ProgressEvent>,
  ): Promise<any> {
    let consumptionRecord: any = null;
    const recordId = uuidv4();
    const resultId = uuidv4();
    try {
      // 步骤0： 幂等性检查
      if (dto.requestId) {
        const existingRecord = await this.consumptionRecordModel.findOne({
          userId,
          'metadata.requestId': dto.requestId,
          status: {
            $in: [ConsumptionStatus.SUCCESS, ConsumptionStatus.PENDING],
          },
        });
        this.logger.log(existingRecord, '====');

        if (existingRecord) {
          // 找到了相同 requestId 的记录
          if (existingRecord.status === ConsumptionStatus.SUCCESS) {
            // 直接返回已有的结果
            this.logger.log(
              `重复请求，返回已有结果：requestId=${dto.requestId}`,
            );

            // 查询之前生成的结果
            const existingResult = await this.resumeQuizResultModel.findOne({
              resultId: existingRecord.recordId,
            });

            if (!existingResult) {
              throw new BadRequestException('结果不存在');
            }

            // 直接返回
            return {
              resultId: existingResult.resultId,
              questions: existingResult.questions,
              summary: existingResult.summary,
              remainCount: await this.getRemainingCount(userId, 'resume'),
              consumptionRecordId: existingRecord.recordId,
              // 缓存标记
              isFromCache: true,
            };
          }
          if (existingRecord.status === ConsumptionStatus.PENDING) {
            // 同一个请求还在处理中，告诉用户稍后查询
            throw new BadRequestException('请求正在处理中, 请稍后查询结果');
          }
        }

        // 1. 检查并扣除次数(原子操作)
        // 扣费失败会在catch中自动退款
        const user = await this.userModel.findOneAndUpdate(
          {
            _id: userId,
            resumeRemainingCount: { $gt: 0 },
          },
          {
            $inc: { resumeRemainingCount: -1 }, // 原子操作： -1
          },
          { new: false },
        );

        // 检查扣费是否成功
        if (!user) {
          throw new BadRequestException('简历押题次数不足，请前往充值页面购买');
        }

        // 记录日志
        this.logger.log(
          `用户扣费成功：userId=${userId},扣费前=${user.resumeRemainingCount}, 扣费后=${user.resumeRemainingCount - 1}`,
        );

        // 2.创建消费记录(pending)
        consumptionRecord = await this.consumptionRecordModel.create({
          recordId,
          user: new Types.ObjectId(userId),
          userId,
          type: ConsumptionType.RESUME_QUIZ,
          status: ConsumptionStatus.PENDING, //key： 标记为处理中
          consumedCount: 1,
          description: `简历押题 - ${dto?.company} ${dto.positionName}`,
          inputData: {
            company: dto?.company || '',
            positionName: dto.positionName,
            minSalary: dto.minSalary,
            maxSalary: dto.maxSalary,
            jd: dto.jd,
            resumeId: dto.requestId,
          },
          resultId,
          metadata: {
            requestId: dto.requestId, //幂等性检查
            promptVersion: dto.promptVersion,
          },
          startedAt: new Date(),
        });
        this.logger.log(`消费记录创建成功：recordId=${recordId}`);

        // ========== 阶段 1: 准备阶段==========
        this.emitProgress(
          progressSubject,
          0,
          '📄 正在读取简历文档...',
          'prepare',
        );
        this.logger.log(`📝 开始提取简历内容: resumeId=${dto.resumeId}`);
        const resumeContent = await this.extractResumeContent(userId, dto);
        this.logger.log(`✅ 简历内容提取成功: ${resumeContent}`);
        this.logger.log(
          `✅ 简历内容提取成功: 长度=${resumeContent.length}字符`,
        );
        this.emitProgress(progressSubject, 5, '✅ 简历解析完成', 'prepare');
        this.emitProgress(
          progressSubject,
          10,
          '🚀 准备就绪，即将开始 AI 生成...',
        );
        // this.getStagePrompt(progressSubject);
        // ========== 阶段 2: AI 生成阶段(10-90%)==========
        const aiStartTime = Date.now();
        this.logger.log(`🤖 开始生成押题部分...`);
        this.emitProgress(
          progressSubject,
          15,
          '🤖 AI 正在理解您的简历内容并生成面试问题...',
        );
        this.getStagePrompt(progressSubject);
        // 第一步：生成押题部分
        const questionsResult =
          await this.aiService.generateResumeQuizQuestionsOnly({
            company: dto?.company || '',
            positionName: dto.positionName,
            minSalary: dto.minSalary,
            maxSalary: dto.maxSalary,
            jd: dto.jd,
            resumeContent,
          });

        this.logger.log(
          `✅ 押题部分生成完成: 问题数=${questionsResult.questions?.length || 0}`,
        );

        this.emitProgress(
          progressSubject,
          50,
          '✅ 面试问题生成完成，开始分析匹配度...',
        );

        // 第二步: 生成匹配度分析
        this.logger.log(`🤖 开始生成匹配度分析...`);
        this.emitProgress(
          progressSubject,
          60,
          '🤖 AI 正在分析您与岗位的匹配度...',
        );

        const analysisResult =
          await this.aiService.generateResumeQuizAnalysisOnly({
            company: dto?.company || '',
            positionName: dto.positionName,
            minSalary: dto.minSalary,
            maxSalary: dto.maxSalary,
            jd: dto.jd,
            resumeContent,
          });

        this.logger.log(`✅ 匹配度分析完成`);

        const aiDuration = Date.now() - aiStartTime;
        this.logger.log(
          `⏱️ AI 总耗时: ${aiDuration}ms (${(aiDuration / 1000).toFixed(1)}秒`,
        );
        // 合并两部分结果
        const aiResult = {
          ...questionsResult,
          ...analysisResult,
        };
        // ========== 阶段 3: 保存结果阶段==========

        const quizResult = await this.resumeQuizResultModel.create({
          resultId,
          user: new Types.ObjectId(userId),
          userId,
          resumeId: dto.resumeId,
          company: dto?.company || '',
          position: dto.positionName,
          jobDescription: dto.jd,
          questions: aiResult.questions,
          totalQuestions: aiResult.questions.length,
          summary: aiResult.summary,
          // AI生成的分布报告数据
          matchScore: aiResult.matchScore,
          matchLevel: aiResult.matchLevel,
          matchedSkills: aiResult.matchedSkills,
          missingSkills: aiResult.missingSkills,
          knowledgeGaps: aiResult.knowledgeGaps,
          learningPriorities: aiResult.learningPriorities,
          radarData: aiResult.radarData,
          strengths: aiResult.strengths,
          weaknesses: aiResult.weaknesses,
          interviewTips: aiResult.interviewTips,
          // 元数据
          consumptionRecordId: recordId,
          aiModel: 'deepseek-chat',
          promptVersion: dto.promptVersion || 'v2',
        });
        this.logger.log(`结果保存成功: resultId=${resultId}`);

        // 更新消费记录为成功
        await this.consumptionRecordModel.findByIdAndUpdate(
          consumptionRecord._id,
          {
            $set: {
              status: ConsumptionStatus.SUCCESS,
              outputData: {
                resultId,
                questionCount: aiResult.usage?.promptTokens as string,
              },
              aiModel: 'deepseek-chat',
              promptTokens: aiResult.usage?.promptTokens,
              completionTokens: aiResult.usage?.completionTokens,
              totalTokens: aiResult.usage?.totalTokens,
              completedAt: new Date(),
            },
          },
        );
        this.logger.log(
          `消费记录已更新为成功状态: recordId=${consumptionRecord.recordId}`,
        );
        // ========== 阶段 4: 返回结果==========
        const result = {
          resultId: resultId,
          questions: questionsResult.questions,
          summary: questionsResult.summary,
          // 匹配度分析数据
          matchScore: analysisResult.matchScore,
          matchLevel: analysisResult.matchLevel,
          matchedSkills: analysisResult.matchedSkills,
          missingSkills: analysisResult.missingSkills,
          knowledgeGaps: analysisResult.knowledgeGaps,
          learningPriorities: analysisResult.learningPriorities,
          radarData: analysisResult.radarData,
          strengths: analysisResult.strengths,
          weaknesses: analysisResult.weaknesses,
          interviewTips: analysisResult.interviewTips,
        };

        // 发送完成事件
        this.emitComplete(progressSubject, result);
        this.emitProgress(
          progressSubject,
          100,
          `✅ 所有分析完成，正在保存结果...响应数据为${JSON.stringify(result)}`,
        );
        return result;
      }
    } catch (error) {
      this.logger.error(
        `× 简历押题生成失败：userId=${userId}, error=${error.message}`,
        error.stack,
      );

      // 失败回滚流程
      try {
        // 1.返还次数 ！！！
        this.logger.log(`开始退还次数： userId=${userId}`);
        await this.refundCount(userId, 'resume');
        this.logger.log(`次数退还成功： userId=${userId}`);
        await this.consumptionRecordModel.findByIdAndUpdate(
          consumptionRecord._id,
          {
            $set: {
              //更新覆盖
              status: ConsumptionStatus.FAILED, // 标记为失败
              errorMessage: error.message, // 记录错误信息
              errorStack:
                process.env.Node_ENV === 'development'
                  ? error.stack
                  : undefined,
              failedAt: new Date(),
              isRefunded: true, // 标记为已退款
              refundedAt: new Date(),
            },
          },
        );
        this.logger.log(
          `消费记录已更新为失败状态：recordId=${consumptionRecord.recordId}`,
        );
      } catch (refundError) {
        //! 退款失败是严重问题，需要人工介入！
        this.logger.error(
          `退款流程失败！这是严重问题，需要人工介入！` +
            `userId=${userId} , originalError=${error.message}, refundError=${refundError.message}`,
          refundError.stack,
        );
        //todo 发送告警通知
      }

      // 3.发送错误事件给前端
      if (progressSubject && !progressSubject.closed) {
        progressSubject.next({
          type: 'error',
          progress: 0,
          label: '生成失败',
          error: error,
        });
        progressSubject.complete();
      }
      throw error;
    }
  }

  // 获取剩余次数
  private async getRemainingCount(
    userId: string,
    type: 'resume' | 'special' | 'behavior',
  ): Promise<number> {
    const user = await this.userModel.findById(userId);
    if (!user) return 0;

    switch (type) {
      case 'resume':
        return user.resumeRemainingCount;
      case 'special':
        return user.specialRemainingCount;
      case 'behavior':
        return user.behaviorRemainingCount;
      default:
        return 0;
    }
  }

  // 不同阶段的提示信息
  private getStagePrompt(
    progressSubject: Subject<ProgressEvent> | undefined,
  ): void {
    if (!progressSubject) return;
    // 定义不同阶段的提示信息
    const progressMessages = [
      // 0-20%: 理解阶段
      { progress: 0.05, message: 'AI 正在深度理解您的简历内容...' },
      { progress: 0.1, message: 'AI 正在分析您的技术栈和项目经验...' },
      { progress: 0.15, message: 'AI 正在识别您的核心竞争力...' },
      { progress: 0.2, message: 'AI 正在对比岗位要求与您的背景...' },
      // 20-50%: 设计问题阶段
      { progress: 0.25, message: 'AI 正在设计针对性的技术问题...' },
      { progress: 0.3, message: 'AI 正在挖掘您简历中的项目亮点...' },
      { progress: 0.35, message: 'AI 正在构思场景化的面试问题...' },
      { progress: 0.4, message: 'AI 正在设计不同难度的问题组合...' },
      { progress: 0.45, message: 'AI 正在分析您的技术深度和广度...' },
      { progress: 0.5, message: 'AI 正在生成基于 STAR 法则的答案...' },
      // 50-70%: 优化阶段
      { progress: 0.55, message: 'AI 正在优化问题的表达方式...' },
      { progress: 0.6, message: 'AI 正在为您准备回答要点和技巧...' },
      { progress: 0.65, message: 'AI 正在提炼您的项目成果和亮点...' },
      { progress: 0.7, message: 'AI 正在调整问题难度分布...' },
      // 70-85%: 完善阶段
      { progress: 0.75, message: 'AI 正在补充技术关键词和考察点...' },
      { progress: 0.8, message: 'AI 正在完善综合评估建议...' },
      { progress: 0.85, message: 'AI 正在做最后的质量检查...' },
      { progress: 0.9, message: 'AI 即将完成问题生成...' },
    ];

    let progress = 0;
    let currentMessage = progressMessages[0];
    const interval = setInterval(
      () => {
        progress += 1;
        currentMessage = progressMessages[progress];
        // 发送进度事件
        this.emitProgress(
          progressSubject,
          progress,
          currentMessage.message,
          'generating',
        );
        // 简单处理, 到了 progressMessages 的 length 就结束了
        if (progress === progressMessages.length - 1) {
          clearInterval(interval);
          this.emitProgress(progressSubject, 100, 'AI 已完成问题生成', 'done');
          return {
            question: [],
            analysis: [],
          };
        }
      },
      Math.floor(Math.random() * (2000 - 800)) + 800,
    ); //每0.8 - 2秒响应一次
  }

  // 发生进度事件
  private emitProgress(
    subject: Subject<ProgressEvent> | undefined,
    progress: number,
    label: string,
    stage?: 'prepare' | 'generating' | 'saving' | 'done',
  ): void {
    if (subject && !subject.closed) {
      subject.next({
        type: 'progress',
        progress: Math.min(Math.max(progress, 0), 100),
        label,
        message: label,
        stage,
      });
    }
  }

  // 发送完成事件
  private emitComplete(
    subject: Subject<ProgressEvent> | undefined,
    data: any,
  ): void {
    if (subject && !subject.closed) {
      subject.next({
        type: 'complete',
        progress: 100,
        label: '生成完成',
        message: '生成完成',
        data,
      });
      subject.complete();
    }
  }

  // 退还次数
  private async refundCount(
    userId: string,
    type: 'resume' | 'special' | 'behavior',
  ): Promise<void> {
    const field =
      type === 'resume'
        ? 'resumeRemainingCount'
        : type === 'special'
          ? 'specialRemainingCount'
          : 'behaviorRemainingCount';

    // 原子操作退还次数
    const result = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $inc: { [field]: 1 },
      },
      { new: true },
    );
    // 验证退款是否成功
    if (!result) {
      throw new Error(`退款失败:用户不存在 userId=${userId}`);
    }
    this.logger.log(
      `次数退还成功: userId=${userId}, type=${type}, 退还后=${result[field]}`,
    );
  }

  // 提取简历内容
  private async extractResumeContent(
    userId: string,
    dto: ResumeQuizDto,
  ): Promise<string> {
    // 优先级 1： 如果直接提供了简历文本，使用它
    if (dto.resumeContent) {
      this.logger.log(
        `使用直接提供的简历文本，长度=${dto.resumeContent.length}字符`,
      );
      return dto.resumeContent;
    }
    // 优先级 2：如果提供了 resumeId, 尝试查询
    if (dto.resumeURL) {
      try {
        // 1.从 URL 下载文件
        const rawText = await this.documentParserService.parseDocumentFromUrl(
          dto.resumeURL || '',
        );
        // 2.清理文本(移除格式化符号等)
        const cleanedText = this.documentParserService.cleanText(rawText);

        // 3.验证内容质量
        const validation =
          this.documentParserService.validateResumeContent(cleanedText);

        if (!validation.isValid) {
          throw new BadRequestException(validation.reason);
        }

        // 4.记录任何警告
        if (validation.warnings && validation.warnings.length > 0) {
          this.logger.warn(`简历解析警告: ${validation.warnings.join(';')}`);
        }

        // 5.检查内容长度（避免超长内容）
        const estimatedTokens =
          this.documentParserService.estimateTokens(cleanedText);

        if (estimatedTokens > 6000) {
          this.logger.warn(
            `简历内容过长：${estimatedTokens} tokens,将进行截断`,
          );
          // 截取前 6000 tokens 对应的字符
          const maxChars = 6000 * 1.5; //约 9000 字符
          const truncatedText = cleanedText.substring(0, maxChars);

          this.logger.log(
            `简历已截断：原长度=${cleanedText.length}，截断后=${truncatedText.length}, tokens≈${this.documentParserService.estimateTokens(truncatedText)}`,
          );

          return truncatedText;
        }
        this.logger.log(
          `简历解析成功： 长度=${cleanedText.length}字符， tokens≈${estimatedTokens}`,
        );
        return cleanedText;
      } catch (error) {
        // 文件解析失败，返回友好的错误信息
        if (error instanceof BadRequestException) {
          throw error;
        }
        this.logger.error(
          `解析简历文件失败：resumeId=${dto.resumeId}, error=${error.message}`,
          error.stack,
        );
        throw new BadRequestException(
          `简历文件解析失败：${error.message}。` +
            `建议：确保上传的是文本型 PDF 或 DOCX 文件, 未加密且未损坏。` +
            `或者直接粘贴历史文本`,
        );
      }
    }

    // 都没提供，返回错误
    throw new BadRequestException('请提供简历URL或简历内容');
  }
}
