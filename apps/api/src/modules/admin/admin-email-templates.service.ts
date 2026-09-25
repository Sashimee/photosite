import { Injectable } from '@nestjs/common';
import { renderPreview, type EmailPreview } from '@photoo/email';
import { EMAIL_TEMPLATE_NAMES, type EmailTemplateName, type Locale } from '@photoo/shared';

@Injectable()
export class AdminEmailTemplatesService {
  list(): readonly EmailTemplateName[] {
    return EMAIL_TEMPLATE_NAMES;
  }

  preview(template: EmailTemplateName, locale: Locale): EmailPreview {
    return renderPreview(template, locale);
  }
}
