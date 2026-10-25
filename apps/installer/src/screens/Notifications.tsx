import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { API_URL } from "../config";
import { useStore } from "../store";
import { colors } from "../theme";
import { Button, Card, H1, Muted } from "../ui";

interface Item {
  id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** New and changed jobs from the office. Needs signal; the job list itself works offline. */
export function Notifications() {
  const st = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const auth = { Authorization: `Bearer ${st.token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/app/notifications`, { headers: auth });
      if (!res.ok) throw new Error();
      setItems(((await res.json()) as { notifications: Item[] }).notifications);
      setError(null);
    } catch {
      setError("Couldn't load notifications. Check your signal and pull to refresh.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAll = async () => {
    await fetch(`${API_URL}/api/app/notifications`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => null);
    setItems((x) => x?.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })) ?? null);
    void st.sync();
  };

  const unread = items?.filter((i) => !i.read_at).length ?? 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
      <H1>Notifications</H1>
      {error && <Muted style={{ marginTop: 12, color: colors.warningText }}>{error}</Muted>}
      {items && items.length === 0 && (
        <Card style={{ marginTop: 16 }}>
          <Muted>Nothing yet. When the office books or changes a job for you, it shows here.</Muted>
        </Card>
      )}
      {unread > 0 && <Button label={`Mark ${unread} as read`} variant="outline" onPress={() => void markAll()} style={{ marginTop: 16 }} />}
      <View style={{ marginTop: 12, gap: 8 }} accessibilityRole="list">
        {items?.map((i) => (
          <Pressable key={i.id} accessibilityRole="text" accessibilityLabel={`${i.read_at ? "" : "Unread: "}${i.title}`}>
            <Card highlight={!i.read_at}>
              <Text style={{ fontSize: 15, fontWeight: i.read_at ? "500" : "700", color: colors.ink }}>{i.title}</Text>
              {i.body ? <Muted style={{ marginTop: 2 }}>{i.body}</Muted> : null}
              <Muted style={{ marginTop: 4, fontSize: 12 }}>{when(i.created_at)}</Muted>
            </Card>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
