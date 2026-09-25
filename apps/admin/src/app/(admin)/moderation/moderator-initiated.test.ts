import { MODERATOR_INITIATED_REPORT_REASON } from '@photoo/shared';
import { describe, expect, it } from 'vitest';

import { isModeratorInitiatedReport } from './moderator-initiated';

describe('isModeratorInitiatedReport', () => {
  it('matches the exact sentinel reason', () => {
    expect(isModeratorInitiatedReport(MODERATOR_INITIATED_REPORT_REASON)).toBe(true);
  });

  it('does not match reporter-written text, even if similar', () => {
    expect(
      isModeratorInitiatedReport('Found by a moderator; no report was filed. Also spam.'),
    ).toBe(false);
  });

  it('does not match ordinary reporter text', () => {
    expect(isModeratorInitiatedReport('This profile is impersonating someone else.')).toBe(false);
  });
});
