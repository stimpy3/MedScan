import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import AlternativesCarousel from '../../components/AlternativesCarousel';
import AvailabilityCard from '../../components/AvailabilityCard';
import ChatInputBar from '../../components/ChatInputBar';
import CompareClarifyCard from '../../components/CompareClarifyCard';
import ComparisonCard from '../../components/ComparisonCard';
import HardShadow from '../../components/HardShadow';
import IntentOptionsCard from '../../components/IntentOptionsCard';
import MedicineCard from '../../components/MedicineCard';
import MedicineOptionsCard from '../../components/MedicineOptionsCard';
import ScheduleFormCard from '../../components/ScheduleFormCard';
import { getApiBaseUrl } from '../services/ocrService';
import { addSchedule } from '../services/scheduleService';
import { checkBeforeSchedule } from '../services/duplicateCheckService';
import { buildSafetyContext, getActiveProfile } from '../services/profileService';

const C = {
  bg:      '#faf9f5',
  surface: '#ede8d8',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
  ochre:   '#9f9065',
};

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

export default function ChatPage() {
  const router = useRouter();
  const { initialMessage, initialOcr } = useLocalSearchParams();

  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentIntent, setCurrentIntent] = useState(null);
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const sessionIdRef = useRef(Date.now().toString() + Math.random().toString(36).substring(2));
  const scrollViewRef = useRef(null);
  const initialTriggered = useRef(false);
  // Snapshotted once per chat session (a chat is short-lived, so a per-mount read is enough);
  // refreshed after in-chat schedule adds so newly-scheduled meds count as "current medicines".
  const safetyContextRef = useRef(null);

  useEffect(() => {
    buildSafetyContext().then(ctx => { safetyContextRef.current = ctx; }).catch(() => {});
  }, []);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    if ((initialMessage || initialOcr) && !initialTriggered.current) {
      initialTriggered.current = true;
      let ocr = null;
      if (initialOcr) {
        try { ocr = JSON.parse(initialOcr); } catch (e) { console.log('[ChatPage] bad initialOcr param', e); }
      }
      sendMessage(initialMessage || '', null, ocr);
    }
  }, [initialMessage, initialOcr]);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates?.height || 0));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const sendMessage = async (textToSubmit, action = null, ocr = null) => {
    const apiText = (textToSubmit || "").trim();
    if (!apiText && !action && !ocr) return;

    let displayText = apiText;
    if (!displayText) {
      if (action?.type === "card_explain") displayText = `Explain ${action.medicine?.name}`;
      else if (action?.type === "card_compare") displayText = `Compare ${action.clickedMedicine?.name}`;
      else if (action?.type === "compare_pick") displayText = `Compare ${action.a?.name} vs ${action.b?.name}`;
      else if (action?.type === "intent_pick") displayText = action.intentLabel || "Continue";
      else if (ocr) displayText = "📷 Scanned image";
    }
    if (!displayText) return;

    const userMsg = { id: `u_${Date.now()}_${Math.random().toString(36).slice(2)}`, text: displayText, sender: 'user' };
    setMessages((prev) => {
      const updated = [...prev, userMsg];
      callClassifier(apiText, prev, action, ocr);
      return updated;
    });

    setIsTyping(true);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const callClassifier = async (text, historyBeforeMessage, action = null, ocr = null) => {
    try {
      const apiUrl = `${getApiBaseUrl()}/api/intent/classify`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: text,
          history: historyBeforeMessage.map(m => ({ text: m.text, sender: m.sender })),
          ...(action ? { action } : {}),
          ...(ocr ? { ocr } : {}),
          ...(safetyContextRef.current ? { safetyContext: safetyContextRef.current } : {})
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log('[ChatPage] classifier non-200 body', errorText);
        throw new Error(`Server status ${response.status}`);
      }

      const data = await response.json();
      const botMsg = {
        id: `b_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        text: data.reply,
        sender: 'bot',
        cardData: data.cardData,
        alternativesData: data.alternativesData,
        comparisonData: data.comparisonData,
        availabilityData: data.availabilityData,
        medicineOptions: data.medicineOptions,
        compareOptions: data.compareOptions,
        compareClarify: data.compareClarify,
        intentOptions: data.intentOptions,
        scheduleFormData: data.scheduleFormData,
        suggestions: data.suggestions
      };
      setMessages((prev) => [...prev, botMsg]);

      if (data.confident && data.intent) {
        setCurrentIntent(data.intent);
        setIntentConfirmed(true);
      } else {
        setIntentConfirmed(false);
      }
    } catch (err) {
      console.error('[ChatPage] Error:', err);
      setMessages((prev) => [...prev, {
        id: `e_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        text: "Sorry, I'm having trouble connecting to the server.",
        sender: 'bot'
      }]);
    } finally {
      setIsTyping(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const handleSend = (ocr = null) => {
    sendMessage(inputText, null, ocr);
    setInputText('');
  };

  const BotBubble = ({ text }) => (
    <HardShadow style={{ maxWidth: '85%' }}>
      <View style={{ borderRadius: 4, borderTopLeftRadius: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border }}>
        <Text style={{ color: C.dark, fontSize: 16, lineHeight: 22 }}>{text}</Text>
      </View>
    </HardShadow>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 0 }}>
        <View style={{ flex: 1 }}>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottomWidth: 1.5, borderBottomColor: C.border}}>
            <HardShadow offset={2}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                onPress={() => router.back()}
              >
                <ArrowLeft size={20} color="#ffffff" />
              </TouchableOpacity>
            </HardShadow>
            <Text style={{ fontSize: 16, fontWeight: '900', color: C.dark, letterSpacing: 0.3 }}>MedScan Assistant</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Message List */}
          <View style={{ flex: 1 }}>
            <ScrollView
              ref={scrollViewRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 100, paddingTop: 8 }}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
            >
              {messages.map((item) => {
                if (item.scheduleFormData) {
                  return (
                    <View key={item.id} style={{ width: '100%' }}>
                      {item.text ? (
                        <View style={{ flexDirection: 'row', marginVertical: 6, justifyContent: 'flex-start' }}>
                          <BotBubble text={item.text} />
                        </View>
                      ) : null}
                      <ScheduleFormCard
                        medicineName={item.scheduleFormData.medicineName}
                        onCheckDuplicates={async (name) => {
                          const activeProfile = await getActiveProfile();
                          return checkBeforeSchedule(name, activeProfile?.id || null);
                        }}
                        onSubmit={async (formData) => {
                          try {
                            const activeProfile = await getActiveProfile();
                            await addSchedule(formData, activeProfile?.id || null);
                            // A newly scheduled medicine is now a "current medicine" for safety
                            // checks — refresh the snapshot so the rest of this chat sees it.
                            buildSafetyContext().then(ctx => { safetyContextRef.current = ctx; }).catch(() => {});
                            router.push('/pages/remindersPage');
                          } catch (err) {
                            console.error('Error saving schedule:', err);
                          }
                        }}
                      />
                    </View>
                  );
                }
                if (item.compareClarify) {
                  return (
                    <View key={item.id} style={{ width: '100%' }}>
                      {item.text ? (
                        <View style={{ flexDirection: 'row', marginVertical: 6, justifyContent: 'flex-start' }}>
                          <BotBubble text={item.text} />
                        </View>
                      ) : null}
                      <CompareClarifyCard data={item.compareClarify} onSelect={sendMessage} />
                    </View>
                  );
                }
                if (item.intentOptions) {
                  return (
                    <View key={item.id} style={{ width: '100%' }}>
                      <IntentOptionsCard question={item.text} options={item.intentOptions} onSelect={sendMessage} />
                    </View>
                  );
                }
                if (item.compareOptions) {
                  return (
                    <View key={item.id} style={{ width: '100%' }}>
                      <MedicineOptionsCard question={item.text} options={item.compareOptions} onSelect={sendMessage} />
                    </View>
                  );
                }
                if (item.medicineOptions) {
                  return (
                    <View key={item.id} style={{ width: '100%' }}>
                      <MedicineOptionsCard question={item.text} options={item.medicineOptions} onSelect={sendMessage} />
                    </View>
                  );
                }
                if (item.cardData) {
                  return (
                    <View key={item.id} style={{ width: '100%', marginVertical: 4 }}>
                      {item.text ? (
                        <View style={{ flexDirection: 'row', marginVertical: 6, justifyContent: 'flex-start' }}>
                          <BotBubble text={item.text} />
                        </View>
                      ) : null}
                      <MedicineCard data={item.cardData} onSendMessage={sendMessage} />
                    </View>
                  );
                }
                if (item.comparisonData) {
                  return (
                    <View key={item.id} style={{ width: '100%', marginVertical: 4 }}>
                      {item.text ? (
                        <View style={{ flexDirection: 'row', marginVertical: 6, justifyContent: 'flex-start' }}>
                          <BotBubble text={item.text} />
                        </View>
                      ) : null}
                      <ComparisonCard data={item.comparisonData} />
                    </View>
                  );
                }
                if (item.alternativesData) {
                  return (
                    <View key={item.id} style={{ width: '100%', marginVertical: 4 }}>
                      {item.text ? (
                        <View style={{ flexDirection: 'row', marginVertical: 6, justifyContent: 'flex-start' }}>
                          <BotBubble text={item.text} />
                        </View>
                      ) : null}
                      <AlternativesCarousel data={item.alternativesData} onSendMessage={sendMessage} />
                    </View>
                  );
                }
                return (
                  <View key={item.id} style={{ flexDirection: 'row', marginVertical: 6, justifyContent: item.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                    <HardShadow style={{ maxWidth: '85%' }}>
                      <View style={{
                        borderRadius: 4,
                        borderTopRightRadius: item.sender === 'user' ? 0 : 4,
                        borderTopLeftRadius: item.sender === 'user' ? 4 : 0,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        backgroundColor: item.sender === 'user' ? C.blue : C.surface,
                        borderWidth: 1.5,
                        borderColor: C.border,
                      }}>
                        <Text style={{ color: item.sender === 'user' ? '#ffffff' : C.dark, fontSize: 16, lineHeight: 22 }}>
                          {item.text}
                        </Text>
                      </View>
                    </HardShadow>
                  </View>
                );
              })}

              {isTyping && (
                <View style={{ flexDirection: 'row', marginVertical: 6, justifyContent: 'flex-start' }}>
                  <HardShadow>
                    <View style={{ borderRadius: 4, borderTopLeftRadius: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border }}>
                      <Text style={{ color: C.dark, fontSize: 16, fontStyle: 'italic' }}>Typing...</Text>
                    </View>
                  </HardShadow>
                </View>
              )}

              {/* Suggestion bubbles */}
              {!isTyping && messages.length > 0 && messages[messages.length - 1].sender === 'bot' && messages[messages.length - 1].suggestions && (
                <View style={{ marginVertical: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
                  {messages[messages.length - 1].suggestions.map((sug, idx) => (
                    <HardShadow key={idx} offset={2}>
                      <TouchableOpacity
                        onPress={() => sendMessage(sug.text, sug.action ? sug.action : { type: "bubble", intent: sug.intent })}
                        activeOpacity={0.7}
                        style={{ backgroundColor: idx % 2 === 0 ? C.blue : C.purple, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 9 }}
                      >
                        <Text style={{ color: '#ffffff', fontWeight: '900', fontSize: 13 }}>{sug.label}</Text>
                      </TouchableOpacity>
                    </HardShadow>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>

          {/* Input bar */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
            style={{ position: 'absolute', left: 0, right: 0, bottom: keyboardHeight ? keyboardHeight + 24 : 24, zIndex: 1000, elevation: 10 }}
          >
            <ChatInputBar
              value={inputText}
              onChangeText={setInputText}
              onSend={handleSend}
              placeholder="Type prompt..."
            />
          </KeyboardAvoidingView>
        </View>
      </View>
    </View>
  );
}
