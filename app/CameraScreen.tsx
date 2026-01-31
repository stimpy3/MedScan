import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { LinearGradient } from "expo-linear-gradient";
import { Flashlight, FlashlightOff, ImageUp, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Dimensions, Image, Text, TouchableOpacity, View } from "react-native";
import { runOCR } from "../utils/ocr";
import OcrBottomSheet from "./components/OcrBottomSheet";

export default function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [ocrText, setOcrText] = useState("");

  useEffect(() => {
    if (!permission) requestPermission();
  }, []);

  const takePicture = async () => {
    if (!cameraRef.current) return;

    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    setCapturedUri(photo.uri);
    setShowCamera(false);

    const croppedUri = await cropToTarget(photo);
    const text = await runOCR(croppedUri);
    
    console.log("📸 OCR Result:", text);
    
    // Set OCR text, even if empty - use a default message
    const detectedText = text && text.length > 0 ? text : "No text detected";
    setOcrText(detectedText);
  };

  const cropToTarget = async (photo: any) => {
    const { width: screenW, height: screenH } = Dimensions.get("window");
    const screenAspect = screenW / screenH;
    const photoAspect = photo.width / photo.height;

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    if (photoAspect > screenAspect) {
      scale = photo.height / screenH;
      offsetX = (photo.width - screenW * scale) / 2;
    } else {
      scale = photo.width / screenW;
      offsetY = (photo.height - screenH * scale) / 2;
    }

    const boxSize = 300;
    const boxX = (screenW - boxSize) / 2;
    const boxY = (screenH - boxSize) / 2;

    return (
      await ImageManipulator.manipulateAsync(
        photo.uri,
        [
          {
            crop: {
              originX: boxX * scale + offsetX,
              originY: boxY * scale + offsetY,
              width: boxSize * scale,
              height: boxSize * scale,
            },
          },
        ],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      )
    ).uri;
  };

  const resetCamera = () => {
    setCapturedUri(null);
    setTorch(false);
    setShowCamera(true);
    setOcrText("");
  };

  const handleFindSimilar = (text: string) => {
    console.log("Find Similar:", text);
    // Navigation will be handled in OcrBottomSheet
  };

  if (!permission?.granted) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-base">
          Camera permission is required
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* CAMERA + UI */}
      <LinearGradient
        colors={["rgba(0,0,0,0.9)", "#0066ff", "white"]}
        start={{ x: 0.5, y: 0.3 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* Camera View */}
        {!capturedUri && showCamera && (
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
          />
        )}

        {/* Captured Image */}
        {capturedUri && (
          <Image
            source={{ uri: capturedUri }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="cover"
          />
        )}

        {/* Reset Button */}
        {capturedUri && (
          <TouchableOpacity
            onPress={resetCamera}
            className="absolute top-16 left-5 w-10 h-10 rounded-full bg-white items-center justify-center z-20"
          >
            <X size={20} />
          </TouchableOpacity>
        )}

        {/* Start Scan Button */}
        {!showCamera && !capturedUri && (
          <TouchableOpacity
            onPress={() => setShowCamera(true)}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: [{ translateX: -50 }, { translateY: -50 }],
              backgroundColor: "white",
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 25,
              zIndex: 100,
            }}
          >
            <Text style={{ color: "black", fontSize: 16, fontWeight: "600" }}>
              Start Scan
            </Text>
          </TouchableOpacity>
        )}

        {/* Top Gradient + Scan Text */}
        {!capturedUri && (
          <LinearGradient
            colors={["rgba(0,0,0,0.8)", "transparent"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            className="absolute top-0 w-full h-28 px-5 pt-16 flex-col justify-center items-center"
          >
            <Text className="text-white text-xl font-semibold">Scan Medicine</Text>
            <Text className="text-white/80 mt-1 text-center">
              Align strip or box inside the frame
            </Text>
          </LinearGradient>
        )}

        {/* Camera Target Overlay */}
        {!capturedUri && (
          <View className="absolute inset-0 items-center justify-center">
            <View className="w-[300px] h-[300px] rounded-2xl">
              <Image
                source={
                  showCamera
                    ? require("../assets/images/cameraTarget.png")
                    : require("../assets/images/cameraTarget0.png")
                }
                style={{ width: "100%", height: "100%" }}
              />
            </View>
          </View>
        )}

        {/* Bottom Camera Controls */}
        {!capturedUri && showCamera && (
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.8)"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            className="absolute bottom-0 w-full px-5 py-6 flex-row justify-center items-center"
          >
            <TouchableOpacity
              onPress={() => setTorch(!torch)}
              className="w-16 h-16 bg-white rounded-full items-center justify-center"
            >
              {torch ? <FlashlightOff /> : <Flashlight />}
            </TouchableOpacity>

            {/* Capture Button with Extra Ring */}
            <View className="mx-10 w-24 h-24 items-center justify-center rounded-full border-2 border-white">
              <TouchableOpacity
                onPress={takePicture}
                className="w-[90%] h-[90%] bg-white rounded-full"
              />
            </View>

            <TouchableOpacity className="w-16 h-16 bg-white rounded-full items-center justify-center">
              <ImageUp />
            </TouchableOpacity>
          </LinearGradient>
        )}
      </LinearGradient>

      {/* Use OcrBottomSheet Component - Show whenever image is captured */}
      {capturedUri && (
        <OcrBottomSheet 
          ocrText={ocrText}
          onFindSimilar={handleFindSimilar}
        />
      )}
    </View>
  );
}