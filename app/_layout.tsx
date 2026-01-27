import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import './globals.css';
export default function RootLayout() {
   return (
    <GestureHandlerRootView className="flex-1">
      <BottomSheetModalProvider>
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
    </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
