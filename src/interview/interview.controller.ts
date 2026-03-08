import {
  Controller,
  Post,
  UseGuards,
  Body,
  Request,
  Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InterviewService } from './services/interview.service';
@Controller('interview')
export class InterviewController {
  constructor(private interviewService: InterviewService) {}
  @Post('analyze-resume')
  @UseGuards(JwtAuthGuard)
  async analyzeResume(
    @Body() body: { position: string; resume: string; jobDescription: string },
    @Request() req: Record<string, string>,
  ) {
    const result = await this.interviewService.analyzeResume(
      req.userId,
      body.position,
      body.resume,
      body.jobDescription,
    );
    return {
      code: 200,
      data: result,
    };
  }

  @Post('continue-conversation')
  async continueConversation(
    @Body() body: { sessionId: string; question: string },
  ) {
    const result = await this.interviewService.continueConversation(
      body.sessionId,
      body.question,
    );

    return {
      code: 200,
      data: {
        response: result,
      },
    };
  }

  // 接口 1：简历押题
  @Post('resume/quiz/stream')
  @UseGuards(JwtAuthGuard)
  async resumeQuizStream(@Body() dto, @Request() req, @Res() res) {}

  // 接口 2：开始模拟面试
  @Post('mock/start')
  @UseGuards(JwtAuthGuard)
  async startMockInterview(@Body() dto, @Request() req) {}

  // 接口 3：回答面试问题
  @Post('mock/answer')
  @UseGuards(JwtAuthGuard)
  async answerMockInterview(@Body() dto, @Request() req) {}

  // 接口 4：结束面试
  @Post('mock/end')
  @UseGuards(JwtAuthGuard)
  async endMockInterview(@Body() data, @Request() req) {}
}
