import BottomSheet from "@gorhom/bottom-sheet";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";


interface Props {
  onFindSimilar: (text: string) => void;
  ocrText: string;
}

export default function OcrBottomSheet({ onFindSimilar, ocrText }: Props) {
   console.log("🔥 OcrBottomSheet FUNCTION EXECUTED");
  const [text, setText] = useState(ocrText);
   const sheetRef = useRef<BottomSheet>(null);

  // Snap points in percentage or absolute
  const snapPoints = useMemo(() => ["20%", "80%"], []);

  // Update OCR text when prop changes
  React.useEffect(() => {
    if (ocrText) setText(ocrText);
  }, [ocrText]);

  React.useEffect(() => {
  console.log("📌 BottomSheet ref:", sheetRef.current);
}, []);

React.useEffect(() => {
  console.log("🧠 OcrBottomSheet MOUNTED");
  console.log("📄 OCR TEXT:", ocrText);
}, []);

  const handleFindSimilar = useCallback(() => {
    onFindSimilar(text);
  }, [text]);

  return (
    <BottomSheet
       ref={sheetRef}
  index={1}
  snapPoints={[300, 600]}
  backgroundStyle={{ backgroundColor: "white" }}
  handleIndicatorStyle={{ backgroundColor: "black" }}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Detected Medicine Details</Text>

        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          placeholder="Detected medicine text will appear here..."
          placeholderTextColor="#9CA3AF"
          style={styles.textInput}
          textAlignVertical="top"
          scrollEnabled
        />

        <TouchableOpacity style={styles.button} onPress={handleFindSimilar}>
          <Text style={styles.buttonText}>Find Similar Medicines</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginVertical: 16,
    color: "#000",
  },
  textInput: {
    height: 160,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#000",
  },
  button: {
    marginTop: 24,
    backgroundColor: "#0066ff",
    paddingVertical: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    textAlign: "center",
    fontSize: 16,
  },
});
