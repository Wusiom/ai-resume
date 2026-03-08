import { Injectable, Logger } from '@nestjs/common';
import { PromptTemplate } from '@langchain/core/prompts';
import { AIModelFactory } from 'src/ai/services/ai-model.factory';
import { Message } from 'src/ai/interfaces/message.interface';
import { CONVERSATION_CONTINUATION_PROMPT } from '../prompts/resume-quiz.prompts';

// 对话继续服务

@Injectable()
export class ConversationContinuationService {
  private readonly logger = new Logger(ConversationContinuationService.name);

  constructor(private aiModelFactory: AIModelFactory) {}

  // 基于对话历史继续对话
  async continue(history: Message[]): Promise<string> {
    // 1.创建Prompt模板
    const prompt = PromptTemplate.fromTemplate(
      CONVERSATION_CONTINUATION_PROMPT,
    );
    // 2.获取模型
    const model = this.aiModelFactory.createDefaultModel();
    // 3.组建链
    const chain = prompt.pipe(model);

    try {
      this.logger.log(`继续对话, 历史消息数：${history.length}`);
      // 4.调用链
      const response = await chain.invoke({
        history: history.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
      });
      // 5.获取回答内容
      const aiResponse = response.content as string;
      this.logger.log('对话继续完成');
      return aiResponse;
    } catch (error) {
      this.logger.error('继续对话失败：', error);
      throw error;
    }
  }
}
