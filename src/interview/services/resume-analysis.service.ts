import { Injectable, Logger } from '@nestjs/common';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { AIModelFactory } from 'src/ai/services/ai-model.factory';
import { RESUME_ANALYSIS_PROMPT } from '../prompts/resume-quiz.prompts';

// 简历分析服务

@Injectable()
export class ResumeAnalysisService {
  private readonly logger = new Logger(ResumeAnalysisService.name);

  constructor(private aiModelFactory: AIModelFactory) {}

  // 分析简历
  async analyze(resumeContent: string, jobDescription: string): Promise<any> {
    // 1. 创建 Prompt 模板
    const prompt = PromptTemplate.fromTemplate(RESUME_ANALYSIS_PROMPT);
    // 2. 获取模型
    const model = this.aiModelFactory.createDefaultModel();
    //3. 创建输出解析器
    const parser = new JsonOutputParser();

    const chain = prompt.pipe(model).pipe(parser);

    try {
      this.logger.log('开始分析简历...');

      const result = await chain.invoke({
        resume_content: resumeContent,
        job_description: jobDescription,
      });
      this.logger.log('简历分析完成');
      return result;
    } catch (error) {
      this.logger.error('简历分析失败：', error);
      throw error;
    }
  }
}
