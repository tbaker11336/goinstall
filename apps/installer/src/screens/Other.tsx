import { ScrollView, View } from "react-native";
import { useStore } from "../store";
import { colors } from "../theme";
import { Button, Card, H1, H2, Muted, SyncBadge } from "../ui";

export function Profile() {
  const st = useStore();
  const u = st.bundle?.user;
  const pending = st.outbox.length + st.files.length;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56 }}>
      <H1>Profile</H1>
      <Card style={{ marginTop: 16 }}>
        <H2>{u?.name ?? "Signed in"}</H2>
        <Muted>{[u?.role, u?.companyName].filter(Boolean).join(" · ")}</Muted>
      </Card>
      <Card>
        <H2 right={<SyncBadge />}>Sync</H2>
        <Muted>{pending ? `${pending} change${pending === 1 ? "" : "s"} saved on this phone, waiting to upload.` : "Everything is uploaded."}</Muted>
        {st.lastSyncAt && <Muted style={{ marginTop: 4 }}>Last synced {new Date(st.lastSyncAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</Muted>}
        <View style={{ height: 12 }} />
        <Button label="Sync now" variant="outline" onPress={() => void st.sync()} />
      </Card>
      <Button
        label="Sign out"
        variant="ghost"
        disabled={pending > 0}
        onPress={() => void st.signOut()}
        style={{ marginTop: 8 }}
      />
      {pending > 0 && <Muted style={{ textAlign: "center", color: colors.warningText }}>Sync your changes before signing out.</Muted>}
    </ScrollView>
  );
}

export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56 }}>
      <H1>{title}</H1>
      <Card style={{ marginTop: 16 }}>
        <Muted>{text}</Muted>
      </Card>
    </ScrollView>
  );
}
