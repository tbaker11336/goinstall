import { Pressable, ScrollView, Text, View } from "react-native";
import type { Nav } from "../nav";
import { useStore } from "../store";
import { colors } from "../theme";
import { SURVEY_LABELS, type Job, type SurveyQuestion } from "../types";
import { BackLink, Button, Card, Checkbox, Field, H1, H2, Muted, PhotoThumb, Progress, Section } from "../ui";
import { takePhoto } from "./Checklist";

const forJob = <T extends { products: string[] }>(items: T[], products: string[]) => items.filter((i) => !i.products.length || i.products.some((p) => products.includes(p)));

function Question({ q, value, fromOnline, onChange }: { q: SurveyQuestion; value: string; fromOnline: boolean; onChange: (v: string) => void }) {
  const hint = fromOnline ? "From online survey · check on site" : (q.help ?? undefined);
  if (q.type === "yes_no") {
    return (
      <View style={{ marginBottom: 10 }}>
        <Checkbox checked={value === "yes"} label={q.label} onChange={(v) => onChange(v ? "yes" : "no")} />
        {hint && <Muted style={{ fontSize: 14, color: fromOnline ? colors.info : colors.muted }}>{hint}</Muted>}
      </View>
    );
  }
  if (q.type === "select" && q.options?.length) {
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink2, marginBottom: 6 }}>{q.label}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={q.label}>
          {q.options.map((o) => (
            <Pressable key={o} accessibilityRole="radio" accessibilityState={{ checked: value === o }} onPress={() => onChange(o)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: value === o ? colors.primary : colors.input, backgroundColor: value === o ? colors.accentTint : colors.card }}>
              <Text style={{ fontWeight: "500", color: value === o ? colors.accentStrong : colors.ink }}>{o}</Text>
            </Pressable>
          ))}
        </View>
        {hint && <Muted style={{ fontSize: 14, marginTop: 6, color: fromOnline ? colors.info : colors.muted }}>{hint}</Muted>}
      </View>
    );
  }
  return <Field label={q.label} value={value} onChangeText={onChange} multiline={q.type === "long_text"} keyboardType={q.type === "number" ? "decimal-pad" : "default"} hint={hint} hintTone={fromOnline ? "info" : "muted"} />;
}

type JobSurvey = Job["surveys"][number];

function surveyState(st: ReturnType<typeof useStore>, job: Job, survey: JobSurvey) {
  const products = job.products.filter((p) => (survey.kind === "ev" ? p === "ev" : p !== "ev"));
  const questions = forJob(st.bundle!.surveyQuestions.filter((q) => q.survey_kind === survey.kind), products).sort((a, b) => a.position - b.position);
  const categories = forJob(st.bundle!.photoCategories.filter((c) => c.survey_kind === survey.kind), products).sort((a, b) => a.position - b.position);
  const local = st.local.survey[survey.id] ?? {};
  const value = (k: string) => (k in local ? (local[k] ?? "") : (survey.fields[k]?.value ?? ""));
  const photosIn = (cat: string) => Object.entries(st.local.photos).filter(([, p]) => p.bookingId === job.id && p.category === cat && (p.surveyKind ?? survey.kind) === survey.kind);
  const answered = questions.filter((q) => value(q.key).trim()).length;
  const photoDone = categories.filter((c) => photosIn(c.key).length > 0).length;
  return { questions, categories, local, value, photosIn, done: answered + photoDone, total: questions.length + categories.length };
}

function SurveySection({ job, survey, showTitle }: { job: Job; survey: JobSurvey; showTitle: boolean }) {
  const st = useStore();
  const { questions, categories, local, value, photosIn } = surveyState(st, job, survey);
  const photoDone = categories.filter((c) => photosIn(c.key).length > 0).length;
  return (
    <View>
      {showTitle && <Section>{SURVEY_LABELS[survey.kind]}</Section>}
      <Card>
        <H2 right={<Muted>{`${photoDone} of ${categories.length}`}</Muted>}>Photos</H2>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {categories.map((c) => {
            const mine = photosIn(c.key);
            return (
              <Pressable
                key={c.key}
                accessibilityRole="button"
                accessibilityLabel={`${mine.length ? "Retake" : "Take"} photo: ${c.label}${showTitle ? ` (${SURVEY_LABELS[survey.kind]})` : ""}`}
                onPress={async () => {
                  const shot = await takePhoto();
                  if (shot) await st.addPhoto(job.id, shot, shot.contentType, c.key, survey.kind);
                }}
                style={{ width: "31%", aspectRatio: 1, borderRadius: 14, overflow: "hidden", borderWidth: mine.length ? 0 : 2, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: mine.length ? colors.surface : "#f1faf6", alignItems: "center", justifyContent: "center" }}
              >
                {mine.length ? <PhotoThumb id={mine.at(-1)![0]} contentType={mine.at(-1)![1].contentType} size={120} /> : <Text style={{ fontSize: 20 }}>📷</Text>}
                <Text style={{ position: mine.length ? "absolute" : "relative", bottom: 0, left: 0, right: 0, textAlign: "center", paddingVertical: 4, backgroundColor: mine.length ? "rgba(249,250,251,0.92)" : "transparent", fontWeight: "600", color: mine.length ? colors.ink : colors.accentStrong }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card>
        <H2>Check on site</H2>
        {questions.map((q) => (
          <Question key={q.key} q={q} value={value(q.key)} fromOnline={!(q.key in local) && survey.fields[q.key]?.source === "online"} onChange={(v) => st.setSurveyField(survey.id, q.key, v)} />
        ))}
      </Card>
    </View>
  );
}

function SurveyProgress({ job }: { job: Job }) {
  const st = useStore();
  const states = job.surveys.map((sv) => surveyState(st, job, sv));
  return <Progress done={states.reduce((n, s) => n + s.done, 0)} total={states.reduce((n, s) => n + s.total, 0)} />;
}

export function Survey({ nav, id }: { nav: Nav; id: string }) {
  const st = useStore();
  const job = st.bundle?.jobs.find((j) => j.id === id);
  if (!job || !st.bundle) return <Muted style={{ padding: 20 }}>This job is no longer assigned to you.</Muted>;
  const completed = st.local.status[id] === "completed" || Boolean(job.completedAt);
  const surveys = [...job.surveys].sort((a) => (a.kind === "solar_battery" ? -1 : 1));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.border }}>
        <BackLink label="My jobs" onPress={nav.back} />
        <H1>Site survey</H1>
        <Muted style={{ marginTop: 6 }}>{[job.address, job.customer?.name].filter(Boolean).join(" · ")}</Muted>
        <SurveyProgress job={job} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        {surveys.map((sv) => (
          <SurveySection key={sv.id} job={job} survey={sv} showTitle={surveys.length > 1} />
        ))}
        {surveys.length === 0 && <Muted>No survey for this project yet. Ask the office to book the survey from the Install & paperwork tab.</Muted>}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Button
          label={completed ? "Survey submitted" : "Submit survey"}
          disabled={completed}
          onPress={() => {
            st.setStatus(id, "completed");
            nav.tab({ name: "jobs" });
          }}
        />
        <Muted style={{ textAlign: "center", marginTop: 8, fontSize: 13 }}>Saved on this phone · syncs when you have signal</Muted>
      </View>
    </View>
  );
}
