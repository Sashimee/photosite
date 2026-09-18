import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ConversationsQuerySchema,
  CursorPaginationQuerySchema,
  IdSchema,
  MarkConversationReadRequestSchema,
  ReportConversationRequestSchema,
  SendMessageRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { ChatService } from './chat.service.js';

@Controller('conversations')
@UseGuards(OriginGuard)
export class ChatController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ConversationsQuerySchema))
    query: ReturnType<(typeof ConversationsQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.list(user, query);
  }

  @Get('unread-count')
  async unreadCount(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.unreadCount(user);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.get(user, id);
  }

  @Get(':id/messages')
  async listMessages(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.listMessages(user, id, query);
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SendMessageRequestSchema))
    body: ReturnType<(typeof SendMessageRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.sendMessage(user, id, body, request.ip);
  }

  @Delete(':id/messages/:messageId')
  async deleteMessage(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Param('messageId', new ZodValidationPipe(IdSchema)) messageId: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.deleteMessage(user, id, messageId);
  }

  @Get(':id/messages/:messageId/attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Param('messageId', new ZodValidationPipe(IdSchema)) messageId: string,
    @Param('attachmentId', new ZodValidationPipe(IdSchema)) attachmentId: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.getAttachmentDownloadUrl(user, id, messageId, attachmentId);
  }

  @HttpCode(200)
  @Post(':id/read')
  async markRead(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(MarkConversationReadRequestSchema))
    body: ReturnType<(typeof MarkConversationReadRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.markRead(user, id, body);
  }

  @HttpCode(200)
  @Post(':id/archive')
  async archive(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.archive(user, id);
  }

  @HttpCode(200)
  @Post(':id/unarchive')
  async unarchive(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.chat.unarchive(user, id);
  }

  @HttpCode(204)
  @Post(':id/report')
  async report(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ReportConversationRequestSchema))
    body: ReturnType<(typeof ReportConversationRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.chat.report(user, id, body);
  }
}
