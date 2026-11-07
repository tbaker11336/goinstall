/**
 * The customer's survey on their proposal: the answers grouped by survey
 * section, each with an optional note from the installer beside it.
 */
import { groupBySection, hasValue, SURVEY_KINDS, type SurveyKind, type SurveyQuestion } from "./survey";

export interface ProposalSurveySection {
  /** "<kind>:<section>", the key notes are stored under. */
  key: string;
  title: string;
  items: { label: string; value: string }[];
  note: string | null;
  hidden: boolean;
}

export type SurveyNotes = Record<string, { note?: string | null; hidden?: boolean }>;

export interface SurveyInput {
  kind: SurveyKind;
  questions: readonly SurveyQuestion[];
  values: Record<string, string | null>;
}

export const surveySectionKey = (kind: SurveyKind, section: string) => `${kind}:${section}`;

/**
 * Sections with at least one answer or a note. With two surveys on the
 * project (solar & battery and EV), titles say which survey they're from.
 */
export function proposalSurvey(surveys: SurveyInput[], notes: SurveyNotes): ProposalSurveySection[] {
  const both = surveys.length > 1;
  const out: ProposalSurveySection[] = [];
  for (const s of surveys) {
    for (const g of groupBySection(s.questions)) {
      const key = surveySectionKey(s.kind, g.section);
      const items = g.questions.flatMap((q) => {
        const v = s.values[q.key];
        return hasValue(v) ? [{ label: q.label, value: v }] : [];
      });
      const note = notes[key]?.note?.trim() || null;
      if (!items.length && !note) continue;
      out.push({ key, title: both ? `${SURVEY_KINDS[s.kind].short} · ${g.section}` : g.section, items, note, hidden: Boolean(notes[key]?.hidden) });
    }
  }
  return out;
}

/** The sections the customer sees. */
export const shownSurvey = (sections: ProposalSurveySection[]) => sections.filter((s) => !s.hidden);
