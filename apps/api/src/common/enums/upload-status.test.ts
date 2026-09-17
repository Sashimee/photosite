import { describe, expect, it } from 'vitest';
import { isAttachableUploadStatus } from './upload-status.js';

describe('isAttachableUploadStatus', () => {
  it('accepts clean and processed', () => {
    expect(isAttachableUploadStatus('clean')).toBe(true);
    expect(isAttachableUploadStatus('processed')).toBe(true);
  });

  it('rejects pending_upload, uploaded, scanning, failed and infected', () => {
    expect(isAttachableUploadStatus('pending_upload')).toBe(false);
    expect(isAttachableUploadStatus('uploaded')).toBe(false);
    expect(isAttachableUploadStatus('scanning')).toBe(false);
    expect(isAttachableUploadStatus('failed')).toBe(false);
    expect(isAttachableUploadStatus('infected')).toBe(false);
  });
});
