import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatDeepSeek } from '@langchain/deepseek';
/**
 * 面试 AI 服务
 * 封装 LangChain + DeepSeek 的调用
 */
@Injectable()
export class InterviewAIService {
  constructor(private readonly configService: ConfigService) {}

  // 初始化模型的方法
  private initializeModel(temperature: number = 0.7) {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 不存在');
    }

    return new ChatDeepSeek({
      apiKey: apiKey,
      model: 'deepseek-chat',
      temperature,
      maxTokens: 4000,
    });
  }
}
