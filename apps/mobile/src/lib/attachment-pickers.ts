import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';

import { MAX_ATTACHMENTS, type PickedFile } from './chat-attachments';

export type PickSource = 'camera' | 'library' | 'files';

export type PickResult =
  | { status: 'picked'; files: PickedFile[] }
  | { status: 'cancelled' }
  | { status: 'denied'; canAskAgain: boolean };

function fromImageAssets(assets: ImagePicker.ImagePickerAsset[]): PickedFile[] {
  return assets.map((asset, index) => ({
    uri: asset.uri,
    name: asset.fileName ?? `photo-${String(Date.now())}-${String(index + 1)}.jpg`,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  }));
}

export async function pickAttachments(source: PickSource, remaining: number): Promise<PickResult> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return { status: 'cancelled' };
    }
    return {
      status: 'picked',
      files: result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      })),
    };
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
    return result.canceled
      ? { status: 'cancelled' }
      : { status: 'picked', files: fromImageAssets(result.assets) };
  }

  return pickFromLibrary(Math.max(1, Math.min(remaining, MAX_ATTACHMENTS)), {});
}

async function pickFromLibrary(
  selectionLimit: number,
  options: ImagePicker.ImagePickerOptions,
): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit,
    ...options,
  });
  if (result.canceled) {
    return { status: 'cancelled' };
  }
  return { status: 'picked', files: fromImageAssets(result.assets) };
}

export function pickPortfolioPhotos(selectionLimit: number): Promise<PickResult> {
  return pickFromLibrary(selectionLimit, {
    quality: 1,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
}

export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}
