import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockLaunchLibrary = jest.fn<(options: unknown) => Promise<unknown>>();
jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible', Current: 'current' },
  requestMediaLibraryPermissionsAsync: () => Promise.resolve({ granted: true, canAskAgain: true }),
  launchImageLibraryAsync: (options: unknown) => mockLaunchLibrary(options),
}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-linking', () => ({}));

import { pickPortfolioPhotos } from './attachment-pickers';

beforeEach(() => {
  mockLaunchLibrary.mockReset();
});

describe('pickPortfolioPhotos', () => {
  it('asks iOS for compatible representations at full quality so HEIC arrives as JPEG', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg', width: 1, height: 1 },
      ],
    });

    const result = await pickPortfolioPhotos(5);

    expect(mockLaunchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 1,
        selectionLimit: 5,
        preferredAssetRepresentationMode: 'compatible',
      }),
    );
    expect(result).toMatchObject({ status: 'picked', files: [{ mimeType: 'image/jpeg' }] });
  });
});
