import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

type MedicineParams = {
  name?: string;
  comp1?: string;
  comp2?: string;
  salt_composition?: string;

  manufacturer?: string;
  pack_size?: string;

  price?: string;
  substitutionType?: string;
  confidence?: string;

  medicine_desc?: string;
  side_effects?: string;
  drug_interactions?: string;
};

export default function MedicineScreen() {
  const router = useRouter();
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isSideEffectsExpanded, setIsSideEffectsExpanded] = useState(false);
  const [isDrugInteractionsExpanded, setIsDrugInteractionsExpanded] = useState(false);

  const {
    name,
    comp1,
    comp2,
    salt_composition,

    manufacturer,
    pack_size,

    price,
    substitutionType,
    confidence,

    medicine_desc,
    side_effects,
    drug_interactions,
  } = useLocalSearchParams<MedicineParams>();

  return (
    <View className="flex-1 bg-[#f1f1eb]">
      {/* Header */}
      <LinearGradient
        colors={["#0066ffe3", "#8fb7dc"]}
        locations={[0, 1.2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        className="pt-12 pb-4 px-4 h-32"
      >
        <View className="relative w-full h-full flex-row items-center">
          <Pressable onPress={() => router.back()} className="absolute left-0 w-fit z-10 h-full flex items-center">
            <ChevronLeft size={28} color="white" />
          </Pressable>
          <Text className="w-full h-fit flex items-center justify-center text-white text-2xl font-semibold text-center mb-8">
            Medicine Details
          </Text>
        </View>
      </LinearGradient>

      {/* Content Card - FIXED SCROLLVIEW */}
      <ScrollView 
        className="flex-1 bg-[#91b7d2]"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mt-5 flex-1 bg-gray-50 rounded-t-3xl px-5 pt-6 pb-8">
          {/* Medicine Name & Price */}
          <View className="flex-row justify-between items-start mb-3">
            <View className="flex-1">
              {name && (
                <Text className="text-xl font-bold text-gray-900 mb-1">
                  {name}
                </Text>
              )}
              {manufacturer && (
                <Text className="text-xs text-gray-500">
                  By {manufacturer}
                </Text>
              )}
            </View>
            {price && (
              <Text className="text-2xl font-bold text-blue-600 ml-3">
                ₹ {price}
              </Text>
            )}
          </View>

          {/* Badges */}
          <View className="flex-row gap-2 mb-5">
            {substitutionType && (
              <View className="px-3 py-1 rounded-full">
                <Text className={`text-xs font-medium ${
                  substitutionType === "EXACT"
                    ? "text-green-600 bg-green-100"
                    : substitutionType === "THERAPEUTIC"
                    ? "text-orange-500 bg-orange-100"
                    : "text-gray-500 bg-gray-100"
                }`}>
                  {substitutionType}
                </Text>
              </View>
            )}
            {confidence && (
              <View className="bg-blue-100 px-3 py-1 rounded-full">
                <Text className="text-blue-700 text-xs font-medium">
                  Confidence: {confidence}
                </Text>
              </View>
            )}
          </View>

          {/* Ingredients Section */}
          {(comp1 || comp2 ) && (
            <View className="mb-5">
              <Text className="text-base font-semibold text-gray-900 mb-2">
                Ingredients:
              </Text>
              {comp1 && (
                <Text className="text-sm text-gray-700 ml-2">• {comp1}</Text>
              )}
              {comp2 && (
                <Text className="text-sm text-gray-700 ml-2">• {comp2}</Text>
              )}
            </View>
          )}

          {/* Description Section */}
          {medicine_desc && (
            <View className="mb-5">
              <Text className="text-base font-semibold text-gray-900 mb-2">
                Description:
              </Text>
              <View className="bg-gray-100 border-[1px] border-[#c7c7c7] rounded-lg p-4">
                <Text 
                  className="text-sm text-gray-700 leading-5"
                  numberOfLines={isDescriptionExpanded ? undefined : 3}
                >
                  {medicine_desc}
                </Text>
                {medicine_desc.length > 150 && (
                  <Pressable 
                    onPress={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    className="mt-2"
                  >
                    <Text className="text-blue-500 font-semibold text-sm">
                      {isDescriptionExpanded ? "Show Less" : "Show More"}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
          
          {/* Drug Interactions Section */}
          {drug_interactions && (
            <View className="mb-5">
              <Text className="text-base font-semibold text-gray-900 mb-2">
                Drug Interactions:
              </Text>
              <View className="bg-white rounded-lg p-4 border border-gray-200">
                <Text 
                  className="text-sm text-gray-700"
                  numberOfLines={isDrugInteractionsExpanded ? undefined : 3}
                >
                  {drug_interactions}
                </Text>
                {drug_interactions.length > 150 && (
                  <Pressable 
                    onPress={() => setIsDrugInteractionsExpanded(!isDrugInteractionsExpanded)}
                    className="mt-2"
                  >
                    <Text className="text-blue-500 font-semibold text-sm">
                      {isDrugInteractionsExpanded ? "Show Less" : "Show More"}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* Side Effects Section */}
          {side_effects && (
            <View className="mb-8">
              <Text className="text-base font-semibold text-red-600 mb-2">
                Possible Side Effects:
              </Text>
              <View className="bg-red-50 rounded-lg p-4 border-[1.5px] border-dashed border-red-200">
                <Text 
                  className="text-sm text-red-600"
                  numberOfLines={isSideEffectsExpanded ? undefined : 3}
                >
                  {side_effects}
                </Text>
                {side_effects.length > 150 && (
                  <Pressable 
                    onPress={() => setIsSideEffectsExpanded(!isSideEffectsExpanded)}
                    className="mt-2"
                  >
                    <Text className="text-red-500 font-semibold text-sm">
                      {isSideEffectsExpanded ? "Show Less" : "Show More"}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}