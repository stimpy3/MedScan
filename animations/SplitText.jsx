import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from "react-native-reanimated";

function AnimatedLetter({
  char,
  index,
  delay,
  duration,
  from,
  to,
  textStyle,
  isLast,
  onLetterAnimationComplete,
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      index * delay,
      withTiming(
        1,
        {
          duration: duration * 1000,
          easing: Easing.out(Easing.cubic),
        },
        finished => {
          if (finished && isLast && onLetterAnimationComplete) {
            runOnJS(onLetterAnimationComplete)();
          }
        }
      )
    );
  }, [delay, duration, index, isLast, onLetterAnimationComplete, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(progress.value, [0, 1], [from.opacity, to.opacity]),
      transform: [
        {
          translateY: interpolate(progress.value, [0, 1], [from.y, to.y]),
        },
      ],
    };
  });

  if (char === "\n") {
    return <Text key={`break-${index}`}>{"\n"}</Text>;
  }

  return (
    <Animated.View key={`char-${index}`} style={animatedStyle}>
      {typeof textStyle === "string" ? (
        <Text className={textStyle}>{char === " " ? "\u00A0" : char}</Text>
      ) : (
        <Text style={textStyle}>{char === " " ? "\u00A0" : char}</Text>
      )}
    </Animated.View>
  );
}

export default function SplitText({
  text,
  style,
  delay = 50,
  duration = 1.25,
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  textAlign = "center",
  onLetterAnimationComplete,
}) {
  const characters = text.split("");

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
      {characters.map((char, index) =>
        char === "\n" ? (
          <View key={`break-${index}`} style={{ width: "100%", height: 0 }} />
        ) : (
          <AnimatedLetter
            key={`${char}-${index}`}
            char={char}
            index={index}
            delay={delay}
            duration={duration}
            from={{
              opacity: from.opacity ?? 0,
              y: from.y ?? 40,
            }}
            to={{
              opacity: to.opacity ?? 1,
              y: to.y ?? 0,
            }}
            textStyle={style}
            isLast={index === characters.length - 1}
            onLetterAnimationComplete={onLetterAnimationComplete}
          />
        )
      )}
    </View>
  );
}