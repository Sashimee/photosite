import { REPORT_TARGET_TYPES } from '../enums.js';
import { IdSchema, errorResponses } from './common.js';
import { apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const ReportTargetTypeSchema = z
  .enum(REPORT_TARGET_TYPES)
  .openapi({ example: 'portfolio_image' });

export const CreateReportRequestSchema = z
  .object({
    targetType: ReportTargetTypeSchema,
    targetId: IdSchema,
    reason: z.string().min(1).max(2000),
  })
  .strict()
  .openapi('CreateReportRequest');

export const CreateReportResponseSchema = z
  .object({
    status: z.literal('received'),
  })
  .strict()
  .openapi('CreateReportResponse');

registry.registerPath({
  method: 'post',
  path: apiPath('/reports'),
  summary: 'Report content for moderation review',
  description: 'Works signed out, for DSA notice-and-action. Rate-limited per IP and per account.',
  tags: ['reports'],
  request: {
    body: { content: { 'application/json': { schema: CreateReportRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Report received',
      content: { 'application/json': { schema: CreateReportResponseSchema } },
    },
    ...errorResponses([400, 404, 422, 429]),
  },
});
