import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

interface Props {
  onFindSimilar: (text: string) => void;
  ocrText: string;
}

export default function OcrBottomSheet({ onFindSimilar, ocrText }: Props) {
  console.log("🔥 OcrBottomSheet RENDERED with ocrText:", ocrText);
  const [text, setText] = useState("");

  // Update OCR text when prop changes
  useEffect(() => {
    console.log("📄 OCR TEXT RECEIVED:", ocrText);
    setText(ocrText || "No text detected");
  }, [ocrText]);

  const handleFindSimilar = useCallback(() => {
    console.log("🚀 Navigating to:", `/similar-medicines-screen?query=${encodeURIComponent(text)}`);
    router.push(`/similar-medicines-screen?query=${encodeURIComponent(text)}`);
  }, [text]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.sheet}>
        {/* Handle bar */}
        <View style={styles.handle} />
        
        <Text style={styles.title}>Detected Medicine Details</Text>

        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          placeholder="Detected medicine text will appear here..."
          placeholderTextColor="#9CA3AF"
          style={styles.textInput}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleFindSimilar}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>Find Similar Medicines</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
    minHeight: 400,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginBottom: 20,
    borderRadius: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#000',
  },
  textInput: {
    height: 180,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#000',
    textAlignVertical: 'top',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#0066ff',
    paddingVertical: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
  },
});