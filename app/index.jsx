// app/index.jsx
// First-launch gate: show the welcome/sign-in screen once, then always go straight to Home.
// "Continue without an account" or a successful sign-in marks the welcome as done.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { View } from "react-native";
import AuthPage, { WELCOME_DONE_KEY } from "./pages/authPage";
import Home from "./pages/home";
import { isLoggedIn } from "./services/authService";

export default function Index() {
  const [gate, setGate] = useState("loading"); // "loading" | "welcome" | "home"

  useEffect(() => {
    (async () => {
      try {
        const [seen, logged] = await Promise.all([
          AsyncStorage.getItem(WELCOME_DONE_KEY),
          isLoggedIn()
        ]);
        setGate(!seen && !logged ? "welcome" : "home");
      } catch {
        setGate("home"); // never trap the user on a broken gate
      }
    })();
  }, []);

  if (gate === "loading") return <View style={{ flex: 1, backgroundColor: "#ede8d8" }} />;
  if (gate === "welcome") return <AuthPage asWelcome onDone={() => setGate("home")} />;
  return <Home />;
}
