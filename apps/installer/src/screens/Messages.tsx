import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Nav } from "../nav";
import { useChats, useStore } from "../store";
import { colors } from "../theme";
import { BackLink, Button, Card, H1, Muted, SyncBadge } from "../ui";

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("en-GB", { timeZone: "Europe/London", ...(today ? {} : { day: "numeric", month: "short" }), hour: "2-digit", minute: "2-digit" });
};

/** One chat per job with the office. Works offline: messages send when there's signal. */
export function Messages({ nav }: { nav: Nav }) {
  const chats = useChats();
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <H1>Messages</H1>
        <SyncBadge />
      </View>
      <Muted>Chat with the office about each job. The customer never sees these.</Muted>
      {chats.length === 0 && (
        <Card>
          <Muted>No jobs yet. Each job you&apos;re booked on gets its own chat here.</Muted>
        </Card>
      )}
      {chats.map((c) => {
        const last = c.messages.at(-1);
        return (
          <Pressable
            key={c.projectId}
            accessibilityRole="button"
            accessibilityLabel={`${c.title}${c.unread ? `, ${c.unread} unread` : ""}`}
            onPress={() => nav.push({ name: "chat", projectId: c.projectId })}
            testID="chat-thread"
          >
            <Card style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 17, fontWeight: "700", flexShrink: 1 }}>{c.title}</Text>
                {c.unread > 0 && (
                  <View style={{ backgroundColor: colors.primary, borderRadius: 999, minWidth: 24, paddingHorizontal: 7, paddingVertical: 2, alignItems: "center" }}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{c.unread}</Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={1} style={{ color: colors.ink3, fontSize: 15 }}>
                {last ? `${last.author}: ${last.body}` : c.customer ? `${c.customer} · no messages yet` : "No messages yet"}
              </Text>
              {last && <Muted style={{ fontSize: 13 }}>{when(last.sentAt)}</Muted>}
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ChatScreen({ nav, projectId }: { nav: Nav; projectId: string }) {
  const st = useStore();
  const chat = useChats().find((c) => c.projectId === projectId);
  const me = st.bundle?.user.id;
  const [text, setText] = useState("");
  const scroll = useRef<ScrollView>(null);
  const count = chat?.messages.length ?? 0;
  const unread = chat?.unread ?? 0;
  // Opening the chat (or a new message arriving while it's open) marks it read.
  useEffect(() => {
    if (unread > 0) st.readChat(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, projectId]);
  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 0);
  }, [count]);
  if (!chat) return <Muted style={{ padding: 20 }}>This job is no longer assigned to you.</Muted>;

  const send = () => {
    const body = text.trim();
    if (!body) return;
    st.sendChat(projectId, body);
    setText("");
    void st.sync();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.border }}>
        <BackLink label="Messages" onPress={nav.back} />
        <H1>{chat.title}</H1>
        <Muted>With the office{chat.customer ? ` · ${chat.customer}` : ""}</Muted>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 10 }} accessibilityLabel="Conversation">
        {chat.messages.length === 0 && <Muted>No messages yet. Ask the office anything about this job.</Muted>}
        {chat.messages.map((m) => {
          const mine = m.authorId === me;
          const pending = chat.pending.has(m.id);
          return (
            <View key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", gap: 2 }}>
              <Text style={{ fontSize: 12, color: colors.ink3, textAlign: mine ? "right" : "left" }}>
                {mine ? "You" : `${m.author}${m.office ? " · office" : ""}`} · {pending ? "sending when online" : when(m.sentAt)}
              </Text>
              <View style={{ backgroundColor: mine ? colors.primary : m.office ? colors.card : colors.accentTint, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, borderWidth: mine ? 0 : 1, borderColor: colors.border, opacity: pending ? 0.7 : 1 }}>
                <Text style={{ color: mine ? "#fff" : colors.ink, fontSize: 16 }}>{m.body}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "flex-end" }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message the office"
          accessibilityLabel="Message the office"
          multiline
          maxLength={2000}
          style={{ flex: 1, minHeight: 48, maxHeight: 140, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }}
          testID="chat-input"
        />
        <Button label="Send" onPress={send} disabled={!text.trim()} style={{ minWidth: 84 }} />
      </View>
    </KeyboardAvoidingView>
  );
}
