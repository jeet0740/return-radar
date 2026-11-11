import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

export type ReceiptSource = 'camera' | 'library';

export async function acquireReceipt(source: ReceiptSource): Promise<string | null> {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Permission denied. Enable photo access in iPhone Settings.');
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.82,
  };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const original = result.assets[0].uri;
  const targetFolder = `${FileSystem.documentDirectory}receipts/`;
  await FileSystem.makeDirectoryAsync(targetFolder, { intermediates: true });
  const destination = `${targetFolder}receipt-${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: original, to: destination });
  return destination;
}

export async function deleteReceipt(uri: string) {
  if (!uri || !uri.startsWith(FileSystem.documentDirectory ?? 'file://')) return;
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
}
