import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatDeepSeek } from '@langchain/deepseek';

@Injectable()
export class AIModelFactory {
  private readonly logger = new Logger(AIModelFactory.name);

  constructor(private configService: ConfigService) {}

  createDefaultModel(): ChatDeepSeek {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 不存在');
    }

    return new ChatDeepSeek({
      apiKey: apiKey || 'dummy-key',
      model:
        this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-chat',
      temperature:
        Number(this.configService.get<string>('DEEPSEEK_TEMPERATURE')) || 0.7,
      maxTokens:
        Number(this.configService.get<string>('DEEPSEEK_MAX_TOKENS')) || 4000,
    });
  }

  createStableModel(): ChatDeepSeek {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 不存在');
    }

    return new ChatDeepSeek({
      apiKey: apiKey || 'dummy-key',
      model:
        this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 4000,
    });
  }

  createCreativeModel(): ChatDeepSeek {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 不存在');
    }

    return new ChatDeepSeek({
      apiKey: apiKey || 'dummy-key',
      model:
        this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-chat',
      temperature: 0.8,
      maxTokens: 4000,
    });
  }
}
