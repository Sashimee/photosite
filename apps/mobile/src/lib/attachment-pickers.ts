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

  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, Math.min(remaining, MAX_ATTACHMENTS)),
        });
  if (result.canceled) {
    return { status: 'cancelled' };
  }
  return { status: 'picked', files: fromImageAssets(result.assets) };
}

export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}
