import { Camera, Image as ImageIcon, Plus, Send, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { extractImage, pickFromCamera, pickFromGallery } from '../app/services/ocrService';
import HardShadow from './HardShadow';

const C = {
  bg:      '#faf9f5',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
};

// Shared input bar for both the home screen and the chat page so behaviour never drifts.
// Owns the + scan button, the source chooser, the selected-image preview, the text field and send.
export default function ChatInputBar({ value, onChangeText, onSend, placeholder = 'Type prompt...' }) {
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSheet, setShowSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showViewer, setShowViewer] = useState(false);

  const choose = async (which) => {
    setShowSheet(false);
    const asset = which === 'camera' ? await pickFromCamera() : await pickFromGallery();
    if (asset) setSelectedImage(asset); // just stage it — scan runs on send
  };

  const submit = async () => {
    let ocr = null;
    if (selectedImage) {
      setUploading(true);
      ocr = await extractImage(selectedImage); // returns { documentType, medicines, rawText }
      setUploading(false);
      setSelectedImage(null);
    }
    onSend?.(ocr); // hand the OCR result (or null) up to the screen
  };

  return (
    <>
      {/* Custom source chooser (matches app UI instead of the native Alert) */}
      <Modal visible={showSheet} transparent animationType="fade" onRequestClose={() => setShowSheet(false)}>
        <Pressable
          onPress={() => setShowSheet(false)}
          style={{ flex: 1, backgroundColor: 'rgba(42,42,42,0.45)', justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 40 }}
        >
          <Pressable onPress={() => {}}>
            <HardShadow>
              <View style={{ backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 18 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: C.dark }}>Scan medicine or prescription</Text>
                  <TouchableOpacity onPress={() => setShowSheet(false)} style={{ padding: 2 }}>
                    <X size={20} color={C.meta} />
                  </TouchableOpacity>
                </View>

                <HardShadow offset={2} style={{ marginBottom: 12 }}>
                  <TouchableOpacity
                    onPress={() => choose('camera')}
                    activeOpacity={0.85}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingVertical: 14, paddingHorizontal: 14 }}
                  >
                    <View style={{ backgroundColor: C.blue, padding: 9, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
                      <Camera size={18} color="#ffffff" />
                    </View>
                    <Text style={{ fontWeight: '800', fontSize: 15, color: C.dark }}>Take Photo</Text>
                  </TouchableOpacity>
                </HardShadow>

                <HardShadow offset={2}>
                  <TouchableOpacity
                    onPress={() => choose('gallery')}
                    activeOpacity={0.85}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingVertical: 14, paddingHorizontal: 14 }}
                  >
                    <View style={{ backgroundColor: C.purple, padding: 9, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
                      <ImageIcon size={18} color="#ffffff" />
                    </View>
                    <Text style={{ fontWeight: '800', fontSize: 15, color: C.dark }}>Choose from Gallery</Text>
                  </TouchableOpacity>
                </HardShadow>
              </View>
            </HardShadow>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Enlarged image viewer */}
      <Modal visible={showViewer} transparent animationType="fade" onRequestClose={() => setShowViewer(false)}>
        <Pressable
          onPress={() => setShowViewer(false)}
          style={{ flex: 1, backgroundColor: 'rgba(42,42,42,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <Pressable onPress={() => {}} style={{ width: '90%', height: '70%' }}>
            {selectedImage && (
              <Image
                source={{ uri: selectedImage.uri }}
                style={{ flex: 1 }}
                resizeMode="contain"
              />
            )}
            <TouchableOpacity
              onPress={() => setShowViewer(false)}
              activeOpacity={0.85}
              style={{ position: 'absolute', top: -14, right: -14, backgroundColor: C.dark, borderRadius: 999, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#ffffff' }}
            >
              <X size={18} color="#ffffff" />
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <HardShadow>
        <View style={{ backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 16, paddingVertical: 10 }}>

          {/* Selected image preview — sits on top, growing the bar's height */}
          {selectedImage && (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <View style={{ width: 64, height: 64 }}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowViewer(true)}>
                  <Image
                    source={{ uri: selectedImage.uri }}
                    style={{ width: 64, height: 64, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}
                  />
                </TouchableOpacity>

                {/* Loader overlay while the image is being read */}
                {uploading && (
                  <View style={{ position: 'absolute', top: 0, left: 0, width: 64, height: 64, borderRadius: 4, backgroundColor: 'rgba(42,42,42,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color="#ffffff" />
                  </View>
                )}

                {/* Remove button — only once the upload has finished */}
                {!uploading && (
                  <TouchableOpacity
                    onPress={() => setSelectedImage(null)}
                    activeOpacity={0.8}
                    style={{ position: 'absolute', top: -8, right: -8, backgroundColor: C.dark, borderRadius: 999, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#ffffff' }}
                  >
                    <X size={12} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Input row: + | text | send */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <HardShadow offset={2} style={{ marginRight: 10 }}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                onPress={() => setShowSheet(true)}
              >
                <Plus size={18} color="#fff" />
              </TouchableOpacity>
            </HardShadow>

            <TextInput
              style={{ flex: 1, color: C.dark, fontSize: 16, fontWeight: '600' }}
              placeholder={placeholder}
              placeholderTextColor="#aaaaaa"
              value={value}
              onChangeText={onChangeText}
              onSubmitEditing={submit}
            />

            <HardShadow offset={2} style={{ marginLeft: 10 }}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: C.purple, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                onPress={submit}
              >
                <Send size={18} color="#fff" />
              </TouchableOpacity>
            </HardShadow>
          </View>
        </View>
      </HardShadow>
    </>
  );
}
