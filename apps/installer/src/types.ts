// Shapes returned by the console's /api/app routes (apps/web/lib/app-jobs.ts).

export interface ReadingField {
  key: string;
  label: string;
  unit: string | null;
}

export interface ChecklistStep {
  id: string;
  kind: "install" | "handover";
  product: "solar" | "battery" | "ev" | "general";
  title: string;
  help: string | null;
  position: number;
  requiresPhoto: boolean;
  requiresSerial: boolean;
  readings: ReadingField[];
}

export type SurveyKind = "solar_battery" | "ev";
export const SURVEY_LABELS: Record<SurveyKind, string> = { solar_battery: "Solar & battery survey", ev: "EV charger survey" };

export interface SurveyQuestion {
  survey_kind: SurveyKind;
  key: string;
  label: string;
  help: string | null;
  type: "text" | "long_text" | "number" | "select" | "yes_no";
  options: string[] | null;
  products: string[];
  section: string;
  position: number;
  required: boolean;
}

export interface PhotoCategory {
  survey_kind: SurveyKind;
  key: string;
  label: string;
  products: string[];
  required: boolean;
  position: number;
}

export interface Captured {
  id: string;
  templateId: string | null;
  done: boolean;
  serial: string | null;
  readings: Record<string, string>;
  note: string | null;
  photoFileIds: string[];
  capturedAt: string;
}

export interface Job {
  id: string;
  projectId: string | null;
  type: "survey" | "install" | "scaffold_up" | "scaffold_down" | "task";
  role: string;
  status: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  signoffName: string | null;
  /** My accept/decline for the job's current dates; null means not answered yet. */
  myResponse: { response: "accepted" | "declined"; reason: string | null; at: string } | null;
  address: string;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  products: string[];
  customer: { name: string; phone: string | null } | null;
  design: {
    solar: { panelCount: number; kWp: number; batteryCount: number; connectionForm: string | null; segments: unknown; plan?: PlanGeometry } | null;
    ev: {
      routeLengthM: number | null;
      cableSizeMm2: number | null;
      route: Point[];
      supply?: Point | null;
      charger?: Point | null;
      supplyLabel?: string | null;
      chargerLabel?: string | null;
    } | null;
  };
  kit: { id: string; description: string; quantity: number; issue: string | null; issueNote: string | null }[];
  surveys: { id: string; kind: SurveyKind; fields: Record<string, { value: string | null; source: string; updatedAt: string }> }[];
  captured: Captured[];
}

export interface Point {
  x: number;
  y: number;
}

/** Roof faces from above, in metres (x east, y south), worked out by the server. */
export interface PlanGeometry {
  roofs: { label: string; used: boolean; outline: Point[]; panels: { corners: Point[]; string: number | null }[]; obstructions: Point[][]; centre: Point }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface ChatMessage {
  id: string;
  authorId: string;
  author: string;
  office: boolean;
  body: string;
  sentAt: string;
}

/** One job's chat with the office. */
export interface Chat {
  projectId: string;
  title: string;
  customer: string | null;
  readAt: string | null;
  messages: ChatMessage[];
}

export interface Bundle {
  serverTime: string;
  /** Optional: bundles saved before chat existed have none. */
  chats?: Chat[];
  user: { id: string; name: string; role: string; companyName: string };
  checklist: ChecklistStep[];
  surveyQuestions: SurveyQuestion[];
  photoCategories: PhotoCategory[];
  jobs: Job[];
}

export type Op =
  | { opId: string; type: "survey_field"; surveyId: string; key: string; value: string | null; capturedAt: string }
  | {
      opId: string;
      type: "checklist_item";
      id: string;
      bookingId: string;
      templateId: string | null;
      done: boolean;
      serial: string | null;
      readings: Record<string, string>;
      note: string | null;
      photoFileIds: string[];
      capturedAt: string;
    }
  | { opId: string; type: "booking_status"; bookingId: string; status: "in_progress" | "completed"; capturedAt: string }
  | { opId: string; type: "signoff"; bookingId: string; name: string; signaturePaths: string[]; capturedAt: string }
  | { opId: string; type: "kit_issue"; kitItemId: string; issue: "missing" | "damaged" | null; note: string | null; capturedAt: string }
  | { opId: string; type: "on_my_way"; bookingId: string; etaMinutes: number; capturedAt: string }
  | { opId: string; type: "team_message"; id: string; projectId: string; body: string; capturedAt: string }
  | { opId: string; type: "chat_read"; projectId: string; capturedAt: string }
  | { opId: string; type: "booking_response"; bookingId: string; response: "accepted" | "declined"; reason: string | null; capturedAt: string };

export interface PendingFile {
  id: string;
  bookingId: string;
  kind: "photo";
  category: string | null;
  surveyKind: SurveyKind | null;
  contentType: string;
}
