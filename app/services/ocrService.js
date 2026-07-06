import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

export const getApiBaseUrl = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envUrl) {
    if (Platform.OS !== 'web' && /localhost|127\.0\.0\.1/.test(envUrl)) {
      console.log('[ocrService] ignoring localhost env on native', { envUrl });
    } else {
      return envUrl;
    }
  }

  if (Platform.OS === 'web') return 'http://localhost:3000';
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';

  const hostUri = Constants.expoConfig?.hostUri || '';
  const host = hostUri.split(':')[0] || 'localhost';
  return `http://${host}:3000`;
};

// Uploads the picked image to the OCR endpoint and returns the parsed Gemini result
// ({ documentType, medicines, rawText }) or null on failure.
export const extractImage = async (asset) => {
  if (!asset?.base64) {
    console.log('[OCR] no base64 on picked asset');
    return null;
  }
  try {
    const apiUrl = `${getApiBaseUrl()}/api/ocr/extract`;
    console.log('[OCR] uploading image to', apiUrl);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: asset.base64, mimeType: asset.mimeType || 'image/jpeg' }),
    });
    if (!response.ok) {
      console.log('[OCR] non-200', response.status, await response.text());
      return null;
    }
    const data = await response.json();
    console.log('[OCR] documentType:', data.documentType);
    console.log('[OCR] medicines:', JSON.stringify(data.medicines, null, 2));
    console.log('[OCR] rawText:\n', data.rawText);
    return data;
  } catch (err) {
    console.error('[OCR] upload failed:', err);
    return null;
  }
};

// Each picker returns the picked asset (or null) so the caller can show a preview.
export const pickFromCamera = async () => {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Camera permission needed', 'Please allow camera access to scan a medicine or prescription.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
  return result.canceled ? null : result.assets[0];
};

export const pickFromGallery = async () => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Gallery permission needed', 'Please allow photo access to upload a medicine or prescription.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7 });
  return result.canceled ? null : result.assets[0];
};

// Shows the source chooser, then calls onPicked(asset) with the selected image.
export const promptScan = (onPicked) => {
  Alert.alert('Scan medicine or prescription', 'Choose a source', [
    { text: 'Take Photo', onPress: async () => { const a = await pickFromCamera(); if (a) onPicked?.(a); } },
    { text: 'Choose from Gallery', onPress: async () => { const a = await pickFromGallery(); if (a) onPicked?.(a); } },
    { text: 'Cancel', style: 'cancel' },
  ]);
};
