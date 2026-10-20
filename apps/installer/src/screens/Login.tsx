import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { API_URL, DEV_SIGN_IN, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import { useStore } from "../store";
import { colors } from "../theme";
import { Button, Card, Field, H1, Muted } from "../ui";

export function Login() {
  const store = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(store.error);
  const [devUsers, setDevUsers] = useState<{ id: string; full_name: string; role: string }[]>([]);

  useEffect(() => {
    if (!DEV_SIGN_IN) return;
    fetch(`${API_URL}/api/app/dev-login`)
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users: typeof devUsers }) => setDevUsers(d.users))
      .catch(() => setError("Can't reach GoInstall. Check your connection."));
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: AsyncStorage, persistSession: false } });
      const { data, error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (e || !data.session) throw new Error(e?.message ?? "Sign-in failed");
      await store.signIn(data.session.access_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const devSignIn = async (userId: string) => {
    setBusy(true);
    const r = await fetch(`${API_URL}/api/app/dev-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    const d = (await r.json()) as { token?: string };
    if (d.token) await store.signIn(d.token);
    else setError("Dev sign-in failed");
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 64, gap: 16 }} keyboardShouldPersistTaps="handled">
      <H1>GoInstall</H1>
      <Muted>Sign in with the email your office invited you with.</Muted>
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        <Button label="Sign in" onPress={signIn} busy={busy} disabled={!email || !password || !SUPABASE_URL} />
        {error && (
          <Text accessibilityRole="alert" style={{ color: colors.danger, marginTop: 12 }}>
            {error}
          </Text>
        )}
      </Card>
      {DEV_SIGN_IN && devUsers.length > 0 && (
        <Card>
          <Text style={{ fontWeight: "700", marginBottom: 8 }}>Development sign-in</Text>
          {devUsers.map((u) => (
            <Pressable key={u.id} accessibilityRole="button" onPress={() => devSignIn(u.id)} style={{ paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 16 }}>
                {u.full_name} <Text style={{ color: colors.muted }}>· {u.role}</Text>
              </Text>
            </Pressable>
          ))}
        </Card>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
