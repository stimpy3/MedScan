import { useFocusEffect, useRouter } from "expo-router";
import { ArrowLeftRight, Calendar, Clock, FileText, Pill, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";

import { SplitText } from "../../animations";
import ChatInputBar from "../../components/ChatInputBar";
import DotTexture from "../../components/DotTexture";
import HardShadow from "../../components/HardShadow";
import { PlusSticker, StarSticker } from "../../components/Stickers";
import { getActiveProfile } from "../services/profileService";

const C = {
  bg:      '#f7f4ec',   // warm paper — same family as the welcome screen, lighter
  surface: '#ede8d8',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  ochre:   '#9f9065',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
  gray:    '#6b6b6b',   // true neutral gray, for the card subtext (meta above is a warm tan)
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

  // Sticker idle motion. The star spins continuously (360° wraps to 0° — no visible loop
  // boundary, truly seamless); the plus ping-pongs a soft bob with sine easing.
  const bob = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    inputY.value      = withDelay(300, withSpring(0, { damping: 18, stiffness: 160 }));
    inputScaleX.value = withDelay(300, withTiming(1, { duration: 380, easing: Easing.out(Easing.exp) }));
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.sin) })
      ),
      -1
    );
    spin.value = withRepeat(withTiming(360, { duration: 10000, easing: Easing.linear }), -1);
  }, []);

  const starStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 + bob.value * 6 }, { rotate: '-8deg' }],
  }));

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

  // One deliberate accent per action: blue = compare, dark = explain (documents),
  // ochre = alternatives, purple = schedule (purple means time everywhere in the app).
  const cards = [
    { icon: Pill,          title: "Compare medicines", description: "Side by side comparison",  action: "compare_medicines", color: C.blue },
    { icon: FileText,      title: "Explain medicine",  description: "Simplify doctor's notes",  action: "explain_medicine",  color: C.dark },
    { icon: ArrowLeftRight,title: "Find alternatives", description: "Search generic options",   action: "find_alternatives", color: C.ochre },
    { icon: Calendar,      title: "Schedule",          description: "Set dose reminders",       action: "schedule_medicine", color: C.purple },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <DotTexture opacity={0.16} />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52, paddingBottom: 100 }}>

        {/* Profile button — round avatar with the active member's initial, star + plus riding it */}
        <View style={{ position: 'absolute', top: 52, left: 20 }}>
          <HardShadow offset={2} borderRadius={22}>
            <TouchableOpacity
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.purple, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}
              onPress={() => router.push('/pages/profilePage')}
            >
              {activeProfileLabel?.trim() ? (
                <Text style={{ color: '#ffffff', fontWeight: '900', fontSize: 18 }}>
                  {activeProfileLabel.trim()[0].toUpperCase()}
                </Text>
              ) : (
                <UserRound size={18} color="#ffffff" />
              )}
            </TouchableOpacity>
          </HardShadow>
          {/* stickers overlap the avatar's rim and always render on top of it */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -10, right: -8, zIndex: 10, elevation: 10 }, starStyle]}>
            <StarSticker size={28} fill={C.blue} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', bottom: -6, left: -6, zIndex: 10, elevation: 10 }, plusStyle]}>
            <PlusSticker size={19} fill={C.ochre} />
          </Animated.View>
        </View>

        {/* My Reminders button — round icon */}
        <HardShadow offset={2} borderRadius={22} style={{ position: 'absolute', top: 52, right: 20 }}>
          <TouchableOpacity
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}
            onPress={() => router.push('/pages/remindersPage')}
          >
            <Clock size={18} color="#ffffff" />
          </TouchableOpacity>
        </HardShadow>

        {/* Hero headline */}
        <View style={{ marginTop: 60, marginBottom: 30 }}>
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
              const { icon: Icon, title, description, action, color } = cards[i];
              return (
                <HardShadow key={i} style={{ flex: 1 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 18, aspectRatio: 1 }}
                    onPress={() => handlePress(action)}
                    activeOpacity={0.85}
                  >
                    <View style={{ backgroundColor: color, width: 44, height: 44, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                      <Icon size={22} color="#ffffff" />
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '900', color, lineHeight: 20, marginBottom: 6 }}>{title}</Text>
                    <Text style={{ fontSize: 13, color: C.gray, lineHeight: 17 }}>{description}</Text>
                  </TouchableOpacity>
                </HardShadow>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {[2, 3].map(i => {
              const { icon: Icon, title, description, action, color } = cards[i];
              return (
                <HardShadow key={i} style={{ flex: 1 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 18, aspectRatio: 1 }}
                    onPress={() => handlePress(action)}
                    activeOpacity={0.85}
                  >
                    <View style={{ backgroundColor: color, width: 44, height: 44, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                      <Icon size={22} color="#ffffff" />
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '900', color, lineHeight: 20, marginBottom: 6 }}>{title}</Text>
                    <Text style={{ fontSize: 13, color: C.gray, lineHeight: 17 }}>{description}</Text>
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
            placeholder="Ask about medicines..."
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
