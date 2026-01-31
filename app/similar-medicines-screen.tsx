import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

interface Medicine {
  name: string;
  price: number;
  comp1: string;
  comp2: string;
  substitutionType: string;
  confidence?: string;
  atc_codes?: string[];
  extraIngredients?: string[];
  extraEffects?: { [key: string]: string };
}

export default function SimilarMedicinesScreen({ route }: any) {
  const { query } = useLocalSearchParams<{ query: string }>();
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
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
        <Text>Finding similar medicines...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>
        Similar Medicines
      </Text>
      <FlatList
        data={data}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        renderItem={({ item }) => (
          <View
            style={{
              padding: 12,
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            <Text style={{ fontWeight: "bold", fontSize: 16 }}>
              {item.name}
            </Text>
            <Text style={{ color: "#666" }}>{item.comp1}</Text>
            <Text style={{ color: "#666" }}>{item.comp2}</Text>

            {/* Price */}
            <Text style={{ marginTop: 8, color: "green", fontWeight: "bold" }}>
              ₹ {item.price}
            </Text>

            {/* Substitution Type */}
            <Text
              style={{
                marginTop: 4,
                fontSize: 12,
                color:
                  item.substitutionType === "EXACT"
                    ? "blue"
                    : item.substitutionType === "THERAPEUTIC"
                    ? "orange"
                    : "gray",
              }}
            >
              {item.substitutionType}
            </Text>

            {/* Confidence */}
            {item.confidence && (
              <Text style={{ fontSize: 12, marginTop: 2, color: "purple" }}>
                Confidence: {item.confidence}
              </Text>
            )}

            {/* ATC Codes */}
            {item.atc_codes && item.atc_codes.length > 0 && (
              <Text style={{ fontSize: 12, marginTop: 2, color: "#555" }}>
                ATC: {item.atc_codes.join(", ")}
              </Text>
            )}

            {/* Extra Ingredients */}
            {item.extraIngredients && item.extraIngredients.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: "bold" }}>Extra Ingredients:</Text>
                {item.extraIngredients.map((ing, idx) => (
                  <Text key={`${ing}-${idx}`} style={{ fontSize: 12, color: "#555" }}>
                    • {ing} : {item.extraEffects?.[ing] || "Unknown"}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}