import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Nav } from "../nav";
import { useStore, useTestBoards } from "../store";
import { BOARD_FIELDS, CIRCUIT_FIELDS, MAX_CIRCUITS, type TestField } from "../test-fields";
import { colors } from "../theme";
import type { Job, TestBoard } from "../types";
import { BackLink, Button, Card, Field, H1, H2, Muted } from "../ui";

const TEXT_KEYS = new Set(["db_ref", "location", "supplied_from", "main_switch_bsen", "spd_bsen", "ref", "designation", "wiring_type", "ref_method", "ocpd_bsen"]);

type Values = Record<string, string>;

const titleOf = (b: Values, i: number) => [b.db_ref || `Board ${i + 1}`, b.location].filter(Boolean).join(" · ");

/** Groups of circuit fields in sheet order. */
const GROUPS = CIRCUIT_FIELDS.reduce<{ group: string; fields: TestField[] }[]>((out, f) => {
  const last = out.at(-1);
  if (last?.group === f.group) last.fields.push(f);
  else out.push({ group: f.group, fields: [f] });
  return out;
}, []);

function Input({ f, value, onChange, a11y }: { f: TestField; value: string; onChange: (v: string) => void; a11y: string }) {
  if (f.options)
    return (
      <View style={{ marginBottom: 14, width: "100%" }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink2, marginBottom: 6 }}>{f.label}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {f.options.map((o) => (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === o }}
              accessibilityLabel={`${a11y}: ${o === "✓" ? "correct" : o === "✗" ? "incorrect" : o}`}
              onPress={() => onChange(value === o ? "" : o)}
              style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: value === o ? colors.primary : colors.input, backgroundColor: value === o ? colors.accentTint : colors.card }}
            >
              <Text style={{ fontSize: 17, fontWeight: "700", color: value === o ? colors.accentStrong : colors.ink2 }}>{o}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  return (
    <View style={{ width: f.key === "designation" || f.key === "location" || f.key === "supplied_from" ? "100%" : "48%" }}>
      <Field
        label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}
        accessibilityLabel={a11y}
        value={value}
        onChangeText={onChange}
        keyboardType={TEXT_KEYS.has(f.key) ? "default" : "numbers-and-punctuation"}
        autoCapitalize={TEXT_KEYS.has(f.key) ? "sentences" : "none"}
      />
    </View>
  );
}

function BoardEditor({ job, board, index, onDone }: { job: Job; board: TestBoard | null; index: number; onDone: () => void }) {
  const st = useStore();
  const [id] = useState(() => board?.id ?? randomUUID());
  const [values, setValues] = useState<Values>(board?.board ?? {});
  const [circuits, setCircuits] = useState<Values[]>(board?.circuits.length ? board.circuits : [{ ref: "1" }]);
  const [open, setOpen] = useState<number | null>(board ? null : 0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = () => {
    st.saveTestBoard(job, { id, position: board?.position ?? index, board: values, circuits: circuits.filter((c) => Object.values(c).some((v) => v.trim())) });
    onDone();
  };
  return (
    <>
      <Card>
        <H2>Distribution board</H2>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
          {BOARD_FIELDS.map((f) => (
            <Input key={f.key} f={f} value={values[f.key] ?? ""} a11y={f.label} onChange={(v) => setValues((b) => ({ ...b, [f.key]: v }))} />
          ))}
        </View>
      </Card>

      <H2>Circuits ({circuits.length})</H2>
      {circuits.map((c, i) => {
        const name = `Circuit ${c.ref || i + 1}`;
        const isOpen = open === i;
        const set = (key: string, v: string) => setCircuits((cs) => cs.map((x, j) => (j === i ? { ...x, [key]: v } : x)));
        const filled = CIRCUIT_FIELDS.filter((f) => c[f.key]).length;
        return (
          <Card key={i} highlight={isOpen} style={{ padding: 0 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : i)} style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 10 }} testID="test-circuit">
              <Text style={{ flex: 1, fontSize: 17, fontWeight: "600", color: colors.ink }}>
                {name}
                {c.designation ? ` · ${c.designation}` : ""}
              </Text>
              <Muted>{`${filled} of ${CIRCUIT_FIELDS.length}`}</Muted>
            </Pressable>
            {isOpen && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                {GROUPS.map((g) => (
                  <View key={g.group}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6, marginBottom: 8 }}>{g.group}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
                      {g.fields.map((f) => (
                        <Input key={f.key} f={f} value={c[f.key] ?? ""} a11y={`${name}: ${f.label}`} onChange={(v) => set(f.key, v)} />
                      ))}
                    </View>
                  </View>
                ))}
                <Button label={`Remove ${name.toLowerCase()}`} variant="ghost" onPress={() => setCircuits((cs) => cs.filter((_, j) => j !== i))} />
              </View>
            )}
          </Card>
        );
      })}
      <Button
        label="+ Add circuit"
        variant="outline"
        disabled={circuits.length >= MAX_CIRCUITS}
        onPress={() => {
          setCircuits((cs) => [...cs, { ref: String(cs.length + 1) }]);
          setOpen(circuits.length);
        }}
      />
      <View style={{ height: 12 }} />
      <Button label="Save board" onPress={save} testID="save-test-board" />
      {board && (
        <Button
          label={confirmRemove ? "Tap again to remove this board" : "Remove board"}
          variant="ghost"
          onPress={() => {
            if (!confirmRemove) return setConfirmRemove(true);
            st.removeTestBoard(job, board);
            onDone();
          }}
        />
      )}
    </>
  );
}

/**
 * Electrical test results for the job: each distribution board's details
 * and its schedule of circuits, as on the certificate. Saved on the phone,
 * sent to the office when there's signal.
 */
export function TestResults({ nav, id }: { nav: Nav; id: string }) {
  const st = useStore();
  const job = st.bundle?.jobs.find((j) => j.id === id);
  const boards = useTestBoards(job ?? { projectId: null, testBoards: [] });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  if (!job) return <Muted style={{ padding: 20 }}>This job is no longer assigned to you.</Muted>;
  const current = editing && editing !== "new" ? boards.find((b) => b.id === editing) ?? null : null;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.border }}>
        <BackLink label={editing ? "Test results" : "Job"} onPress={() => (editing ? setEditing(null) : nav.back())} />
        <H1>{editing ? (current ? titleOf(current.board, boards.indexOf(current)) : "New board") : "Electrical test results"}</H1>
        {!editing && <Muted style={{ marginTop: 6 }}>Each board and its circuits, as on the certificate schedule. Saved on your phone and sent when you have signal.</Muted>}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {editing ? (
          <BoardEditor key={editing} job={job} board={current} index={boards.length} onDone={() => setEditing(null)} />
        ) : (
          <>
            {boards.length === 0 && <Muted style={{ marginBottom: 12 }}>No boards yet.</Muted>}
            {boards.map((b, i) => (
              <Card key={b.id}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${titleOf(b.board, i)}`} onPress={() => setEditing(b.id)} testID="test-board">
                  <Text style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{titleOf(b.board, i)}</Text>
                  <Muted>{`${b.circuits.length} circuit${b.circuits.length === 1 ? "" : "s"}`}</Muted>
                </Pressable>
              </Card>
            ))}
            <Button label="+ Add a board" variant="outline" onPress={() => setEditing("new")} testID="add-test-board" />
          </>
        )}
      </ScrollView>
    </View>
  );
}
