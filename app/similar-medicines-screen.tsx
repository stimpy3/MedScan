// app/similar-medicines-screen.tsx
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  Text,
  View
} from "react-native";

interface Medicine {
  name: string;
  price: number;
  comp1: string;
  comp2?: string;
  salt_composition?: string;
  substitutionType: string;
  confidence?: string;
  atc_codes?: string[];
  extraIngredients?: string[];
  extraEffects?: { [key: string]: string };

  manufacturer?: string;
  pack_size?: string;

  medicine_desc?: string;
  side_effects?: string;
  drug_interactions?: string;
}

// Skeleton Card Component
const SkeletonCard = () => {
  const pulseAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View className="bg-white rounded-lg p-4 mb-4">
      <View className="flex-row justify-between items-center">
        <View className="flex-1 pr-2">
          <Animated.View
            style={{ opacity }}
            className="bg-gray-200 h-5 w-3/4 rounded mb-2"
          />
          <Animated.View
            style={{ opacity }}
            className="bg-gray-200 h-4 w-1/2 rounded mb-1"
          />
          <Animated.View
            style={{ opacity }}
            className="bg-gray-200 h-4 w-2/3 rounded"
          />
        </View>
        <Animated.View
          style={{ opacity }}
          className="bg-gray-200 h-8 w-20 rounded"
        />
      </View>

      <View className="flex-row items-center mt-6 gap-3">
        <Animated.View
          style={{ opacity }}
          className="bg-gray-200 h-6 w-24 rounded-md"
        />
        <Animated.View
          style={{ opacity }}
          className="bg-gray-200 h-6 w-32 rounded-md"
        />
      </View>
    </View>
  );
};

export default function SimilarMedicinesScreen() {
  const { query } = useLocalSearchParams<{ query: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Medicine[]>([]);

  useEffect(() => {
    const fetchMedicines = async () => {
      try {
        const res = await fetch(
          "http://192.168.29.153:3000/medicine/find-similar",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ingredients: query }),
          }
        );
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.log("❌ Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    if (query) fetchMedicines();
  }, [query]);

  if (loading) {
    return (
      <LinearGradient
        colors={["#0066ffe3", "#f1f1eb"]}
        locations={[0, 0.4]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        className="flex-1"
      >
        <View className="flex-1 px-4">
          {/* Back Button */}
          <Pressable onPress={() => router.back()} className="pt-12 pb-4 w-fit">
            <ChevronLeft size={36} color="white" />
          </Pressable>

          {/* Title */}
          <Text className="text-white text-2xl text-center font-bold mb-6">
            Finding Similar Medicines...
          </Text>

          {/* Skeleton Cards */}
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={["#0066ffe3", "#f1f1eb"]}
      locations={[0, 0.4]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="flex-1"
    >
      <FlatList
        data={data}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListHeaderComponent={
          <View className="flex">
            {/* Back Button */}
            <Pressable
              onPress={() => router.back()}
              className="pt-12 pb-4 w-fit"
            >
              <ChevronLeft size={36} color="white" />
            </Pressable>

            {/* Title */}
            <Text className="text-white text-2xl text-center font-bold mb-6">
              Similar Medicines
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() =>
              router.push({
                 pathname: "/MedicineScreen",
                 params: {
                     name: item.name,
                     comp1: item.comp1,
                     comp2: item.comp2 ?? "",
                     salt_composition: item.salt_composition ?? "",
             
                     manufacturer: item.manufacturer ?? "",
                     pack_size: item.pack_size ?? "",
             
                     price: item.price.toString(),
                     substitutionType: item.substitutionType,
                     confidence: item.confidence ?? "",
             
                     medicine_desc: item.medicine_desc ?? "",
                     side_effects: item.side_effects ?? "",
                     drug_interactions: item.drug_interactions ?? "",
                   },
            })}>
             <View className="bg-white rounded-lg p-4 mb-4">
               {/* Name, Comps and Price side by side */}
               <View className="flex-row justify-between items-center">
                 <View className="flex-1 pr-2 h-fit">
                   <Text className="font-bold text-base">{item.name}</Text>
                   <Text className="text-gray-600 text-sm">{item.comp1}</Text>
                   <Text className="text-gray-600 text-sm">{item.comp2}</Text>
                 </View>
   
                 <Text className="text-blue-500 font-bold text-2xl">
                   ₹{item.price}
                 </Text>
               </View>
   
               {/* Substitution Type and Confidence side by side */}
               <View className="flex-row items-center mt-6 gap-3">
                 <Text
                   className={`text-xs p-1 rounded-md ${
                     item.substitutionType === "EXACT"
                       ? "text-green-600 bg-green-100"
                       : item.substitutionType === "THERAPEUTIC"
                       ? "text-orange-500 bg-orange-100"
                       : "text-gray-500 bg-gray-100"
                   }`}
                 >
                   {item.substitutionType}
                 </Text>
   
                 {item.confidence && (
                   <Text className="text-xs p-1 bg-purple-100 rounded-md text-purple-600">
                     Confidence: {item.confidence}
                   </Text>
                 )}
               </View>
   
               {/* ATC Codes */}
               {item.atc_codes && item.atc_codes.length > 0 && (
                 <Text className="text-xs text-gray-500 mt-1">
                   ATC: {item.atc_codes.join(", ")}
                 </Text>
               )}
   
               {/* Extra Ingredients */}
               {item.extraIngredients && item.extraIngredients.length > 0 && (
                 <View className="mt-2">
                   <Text className="text-xs font-bold">Extra Ingredients:</Text>
                   {item.extraIngredients.map((ing, idx) => (
                     <Text
                       key={`${ing}-${idx}`}
                       className="text-xs text-gray-500"
                     >
                       • {ing} : {item.extraEffects?.[ing] || "Unknown"}
                     </Text>
                   ))}
                 </View>
               )}
             </View>
          </Pressable>
        )}
      />
    </LinearGradient>
  );
}