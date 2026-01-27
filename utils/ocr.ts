import * as ImageManipulator from "expo-image-manipulator";
import { getTextFromFrame } from "expo-text-recognition";

export async function runOCR(imageUri: string): Promise<string> {
  try {
    console.log("🟡 OCR started");

    const resized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1000 } }],
      {
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    // ✅ Use getTextFromFrame with the URI
    const result = await getTextFromFrame(resized.uri, false);

    console.log("📄 OCR result:", result);

    if (!result || result.length === 0) {
      return "No text detected";
    }

    // Result is an array of strings, join them
    return result.join("\n");
  } catch (err) {
    console.error("❌ OCR error:", err);
    return "No text detected";
  }
}