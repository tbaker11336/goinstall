import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Nav, Route } from "./src/nav";
import { Checklist } from "./src/screens/Checklist";
import { JobScreen } from "./src/screens/Job";
import { Jobs } from "./src/screens/Jobs";
import { Login } from "./src/screens/Login";
import { Notifications } from "./src/screens/Notifications";
import { Placeholder, Profile } from "./src/screens/Other";
import { SignOff } from "./src/screens/SignOff";
import { Survey } from "./src/screens/Survey";
import { StoreProvider, useStore } from "./src/store";
import { colors } from "./src/theme";

const TABS: { route: Route; label: string; icon: string }[] = [
  { route: { name: "jobs" }, label: "Jobs", icon: "▣" },
  { route: { name: "messages" }, label: "Alerts", icon: "✉" },
  { route: { name: "van" }, label: "Van stock", icon: "⬡" },
  { route: { name: "profile" }, label: "Profile", icon: "◯" },
];

function Shell() {
  const st = useStore();
  const [stack, setStack] = useState<Route[]>([{ name: "jobs" }]);
  const route = stack.at(-1)!;
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const nav: Nav = { route, push: (r) => setStack((s) => [...s, r]), back, tab: (r) => setStack([r]) };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, back]);

  if (!st.ready) return null;
  if (!st.token) return <Login />;
  const isTab = TABS.some((t) => t.route.name === route.name);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {route.name === "jobs" && <Jobs nav={nav} />}
        {route.name === "messages" && <Notifications />}
        {route.name === "van" && <Placeholder title="Van stock" text="Van stock tracking arrives in a later update. Report missing or damaged kit from the job's kit check." />}
        {route.name === "profile" && <Profile />}
        {route.name === "job" && <JobScreen nav={nav} id={route.id} />}
        {route.name === "survey" && <Survey nav={nav} id={route.id} />}
        {route.name === "checklist" && <Checklist nav={nav} id={route.id} />}
        {route.name === "signoff" && <SignOff nav={nav} id={route.id} />}
      </View>
      {isTab && (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: 8 }}>
          {TABS.map((t) => {
            const sel = t.route.name === route.name;
            return (
              <Pressable key={t.label} accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={t.label} onPress={() => nav.tab(t.route)} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}>
                <Text style={{ fontSize: 20, color: sel ? colors.primary : colors.ink3 }}>{t.icon}</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? colors.primary : colors.ink3 }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
          <Shell />
        </SafeAreaView>
        <StatusBar style="dark" />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
