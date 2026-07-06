import { useRouter, useFocusEffect } from "expo-router";
import { ArrowLeftRight, Calendar, Clock, FileText, Pill, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";

import { SplitText } from "../../animations";
import ChatInputBar from "../../components/ChatInputBar";
import HardShadow from "../../components/HardShadow";
import { getActiveProfile } from "../services/profileService";

const C = {
  bg:      '#faf9f5',
  surface: '#ede8d8',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  ochre:   '#9f9065',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
};

const CARD_SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

const BTN_SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
};

export default function Home() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputText, setInputText] = useState("");
  const [activeProfileLabel, setActiveProfileLabel] = useState("Me");
  const router = useRouter();

  useFocusEffect(useCallback(() => {
    getActiveProfile().then(p => { if (p) setActiveProfileLabel(p.label); });
  }, []));

  // Input bar animation (translateY + scaleX)
  const inputY = useSharedValue(80);
  const inputScaleX = useSharedValue(0.3);

  useEffect(() => {
    inputY.value      = withDelay(300, withSpring(0, { damping: 18, stiffness: 160 }));
    inputScaleX.value = withDelay(300, withTiming(1, { duration: 380, easing: Easing.out(Easing.exp) }));
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates?.height || 0));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const inputStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: inputY.value }, { scaleX: inputScaleX.value }],
  }));

  const handlePress = action => {
    let query = "";
    if (action === "compare_medicines") query = "I want to compare medicines";
    else if (action === "explain_medicine") query = "I want to explain medicine";
    else if (action === "find_alternatives") query = "I want to find alternatives";
    else if (action === "schedule_medicine") query = "I want to schedule medicine";
    router.push({ pathname: '/pages/chatPage', params: { initialMessage: query } });
  };

  const handleSend = (ocr = null) => {
    const text = inputText.trim();
    if (!text && !ocr) return;
    setInputText("");
    // Hand off to the chat page, carrying any typed text and/or the scanned image's OCR result.
    router.push({
      pathname: '/pages/chatPage',
      params: {
        ...(text ? { initialMessage: text } : {}),
        ...(ocr ? { initialOcr: JSON.stringify(ocr) } : {})
      }
    });
  };

  const cards = [
    { icon: Pill,          title: "Compare medicines", description: "Side by side comparison",  action: "compare_medicines" },
    { icon: FileText,      title: "Explain medicine",  description: "Simplify doctor's notes",  action: "explain_medicine" },
    { icon: ArrowLeftRight,title: "Find alternatives", description: "Search generic options",   action: "find_alternatives" },
    { icon: Calendar,      title: "Schedule",          description: "Set dose reminders",       action: "schedule_medicine" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52, paddingBottom: 100 }}>

        {/* Profile button */}
        <HardShadow offset={2} style={{ position: 'absolute', top: 52, left: 20 }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#6b5390', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}
            onPress={() => router.push('/pages/profilePage')}
          >
            <UserRound size={15} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontWeight: '800', marginLeft: 6, fontSize: 13 }}>{activeProfileLabel}</Text>
          </TouchableOpacity>
        </HardShadow>

        {/* My Reminders button */}
        <HardShadow offset={2} style={{ position: 'absolute', top: 52, right: 20 }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.ochre, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}
            onPress={() => router.push('/pages/remindersPage')}
          >
            <Clock size={15} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontWeight: '800', marginLeft: 6, fontSize: 13 }}>My Reminders</Text>
          </TouchableOpacity>
        </HardShadow>

        {/* Hero title */}
        <View style={{ alignItems: 'flex-start', marginTop: 60, marginBottom: 32 }}>
          <SplitText
            text={`What would you\nlike to know today?`}
            style={"text-[32px] font-black text-[#2a2a2a] leading-[40px]"}
            delay={50}
            duration={1.25}
            from={{ opacity: 0, y: 40 }}
            to={{ opacity: 1, y: 0 }}
            textAlign="left"
          />
        </View>

        {/* Feature cards grid */}
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {[0, 1].map(i => {
              const { icon: Icon, title, description, action } = cards[i];
              return (
                <HardShadow key={i} style={{ flex: 1 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 18, aspectRatio: 1 }}
                    onPress={() => handlePress(action)}
                    activeOpacity={0.85}
                  >
                    <View style={{ backgroundColor: C.blue, width: 44, height: 44, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                      <Icon size={22} color="#ffffff" />
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: C.dark, lineHeight: 20, marginBottom: 6 }}>{title}</Text>
                    <Text style={{ fontSize: 13, color: C.meta, lineHeight: 17 }}>{description}</Text>
                  </TouchableOpacity>
                </HardShadow>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {[2, 3].map(i => {
              const { icon: Icon, title, description, action } = cards[i];
              return (
                <HardShadow key={i} style={{ flex: 1 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 18, aspectRatio: 1 }}
                    onPress={() => handlePress(action)}
                    activeOpacity={0.85}
                  >
                    <View style={{ backgroundColor: C.blue, width: 44, height: 44, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                      <Icon size={22} color="#ffffff" />
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: C.dark, lineHeight: 20, marginBottom: 6 }}>{title}</Text>
                    <Text style={{ fontSize: 13, color: C.meta, lineHeight: 17 }}>{description}</Text>
                  </TouchableOpacity>
                </HardShadow>
              );
            })}
          </View>
        </View>
      </View>

      {/* Input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        style={{ position: 'absolute', left: 20, right: 20, bottom: keyboardHeight ? keyboardHeight + 24 : 28, zIndex: 1000, elevation: 10 }}
      >
        <Animated.View style={inputStyle}>
          <ChatInputBar
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            placeholder="Ask anything about medicines..."
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
