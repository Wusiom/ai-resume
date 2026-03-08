import { Injectable, Logger } from '@nestjs/common';
import { Message, SessionData } from '../interfaces/message.interface';
import { v4 as generateUUID } from 'uuid';
import { PromptTemplate } from '@langchain/core/prompts';
import { AIModelFactory } from 'src/ai/services/ai-model.factory';

@Injectable()
export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);
  private sessions = new Map<string, SessionData>();
  constructor(private aiModelFactory: AIModelFactory) {}

  // 创建新会话
  createSession(
    userId: string,
    position: string,
    systemMessage: string,
  ): string {
    const sessionId = generateUUID();
    const sessionData: SessionData = {
      sessionId,
      userId,
      position,
      messages: [
        {
          role: 'system',
          content: systemMessage,
        },
      ],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.sessions.set(sessionId, sessionData);
    this.logger.log(
      `创建会话：${sessionId}, 用户：${userId}, 职位：${position}`,
    );
    return sessionId;
  }

  // 向会话添加消息
  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
  ): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`会话不存在：${sessionId}`);
    }

    session.messages.push({
      role,
      content,
    });

    session.lastActivityAt = new Date();
    this.logger.debug(`添加消息到会话 ${sessionId}: ${role}`);
  }

  // 获取完整的对话历史
  getHistory(sessionId: string): Message[] {
    const session = this.sessions.get(sessionId);
    return session?.messages || [];
  }

  // 获取最近的N条消息（用于优于 Token 使用）
  getRecentMessages(sessionId: string, count: number = 10): Message[] {
    const history = this.getHistory(sessionId);
    if (history.length === 0) {
      return [];
    }
    const systemMessage = history[0];

    const recentMessages = history.slice(-count);

    if (recentMessages[0]?.role !== 'system') {
      return [systemMessage, ...recentMessages];
    }

    return recentMessages;
  }
  // 总结长对话
  async summarizeLongConversation(
    sessionId: string,
    minMessages: number = 30,
  ): Promise<void> {
    const history = this.getHistory(sessionId);

    // 如果消息数少于阈值，不需要总结
    if (history.length < minMessages) {
      return;
    }

    this.logger.log(
      `开始总结长对话, sessionId: ${sessionId}, 消息数: ${history.length}`,
    );
    // 总结第二条到倒数第5条的消息，保留最后5条原始消息
    const conversationToSummarize = history.slice(1, -5);

    // 创建总结Prompt
    const summaryPrompt = PromptTemplate.fromTemplate(`
        请总结以下对话的要点。用 2-3 句话，尽量简洁，保留重要信息。
    
        对话内容：
        {conversation}
    
        总结结果：
          `);

    const model = this.aiModelFactory.createDefaultModel();
    const chain = summaryPrompt.pipe(model);

    try {
      const summary = await chain.invoke({
        conversation: conversationToSummarize
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n\n'),
      });
      const summaryContent = summary.content || summary;
      const newHistory: Message[] = [
        history[0],
        {
          role: 'system',
          content: `【之前对话的总结】${summaryContent}`,
        },
        ...history.slice(-5), //保留5条信息
      ];

      const session = this.sessions.get(sessionId);
      if (session) {
        session.messages = newHistory;
        this.logger.log(
          `总结成功，消息数从${history.length} 减少到 ${newHistory.length}`,
        );
      }
    } catch (error) {
      this.logger.error(`总结对话失败: ${error}`);
    }
  }

  // 结束会话
  endSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      this.logger.log(`结束会话：${sessionId}`);
    }
  }

  // 清理过期会话 1小时
  cleanupExpiredSessions(): void {
    const now = new Date();
    const expirationTime = 60 * 60 * 1000;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now.getTime() - session.lastActivityAt.getTime() > expirationTime) {
        this.logger.warn(`清理过期会话: ${sessionId}`);
        this.sessions.delete(sessionId);
      }
    }
  }
}
