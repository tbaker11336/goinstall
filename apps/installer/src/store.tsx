import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { saveBlob, formPart, removeBlob } from "./blobs";
import { API_URL } from "./config";
import type { Bundle, Captured, Job, Op, PendingFile, SurveyKind } from "./types";

/**
 * Offline-first state. Everything the installer captures is saved on the
 * phone first (state + an outbox of ops and files), then synced when there's
 * a connection: files upload first, then ops replay in order. The server
 * applies last-write-wins by capture time and keeps overwritten values.
 */

export type SyncStatus = "synced" | "pending" | "syncing" | "offline" | "error";

interface Local {
  checklist: Record<string, Record<string, Captured>>; // bookingId → stepId → capture
  survey: Record<string, Record<string, string | null>>; // surveyId → key → value
  photos: Record<string, { contentType: string; bookingId: string; category: string | null; surveyKind?: SurveyKind | null }>;
  status: Record<string, "in_progress" | "completed">;
  signoff: Record<string, { name: string; signatureFileId: string | null }>;
  kitChecked: Record<string, boolean>;
  /** Accept/decline made on this phone, with the job start it was for. Optional: older saved state has none. */
  responses?: Record<string, JobResponse & { forStartsAt: string }>;
}

export type JobResponse = { response: "accepted" | "declined"; reason: string | null };

interface Persisted {
  token: string | null;
  bundle: Bundle | null;
  local: Local;
  outbox: Op[];
  files: PendingFile[];
  lastSyncAt: string | null;
}

const EMPTY: Persisted = {
  token: null,
  bundle: null,
  local: { checklist: {}, survey: {}, photos: {}, status: {}, signoff: {}, kitChecked: {} },
  outbox: [],
  files: [],
  lastSyncAt: null,
};
const KEY = "goinstall-installer-v1";

interface Store extends Persisted {
  ready: boolean;
  online: boolean;
  status: SyncStatus;
  error: string | null;
  signIn(token: string): Promise<void>;
  signOut(): Promise<void>;
  sync(): Promise<void>;
  capture(bookingId: string, stepId: string, patch: Partial<Omit<Captured, "id" | "templateId" | "capturedAt">>): void;
  addPhoto(bookingId: string, source: { uri: string; base64?: string | null }, contentType: string, category: string | null, surveyKind?: SurveyKind | null): Promise<string>;
  setSurveyField(surveyId: string, key: string, value: string | null): void;
  setStatus(bookingId: string, status: "in_progress" | "completed"): void;
  signOff(bookingId: string, name: string, signaturePaths: string[]): Promise<void>;
  setKitChecked(kitId: string, checked: boolean): void;
  reportKit(kitId: string, issue: "missing" | "damaged" | null, note: string | null): void;
  onMyWay(bookingId: string, etaMinutes: number): void;
  respond(job: Pick<Job, "id" | "startsAt">, response: "accepted" | "declined", reason: string | null): void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

const now = () => new Date().toISOString();

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Persisted>(EMPTY);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(state);
  ref.current = state;

  // Load once, then persist every change.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setState({ ...EMPTY, ...(JSON.parse(raw) as Persisted) }))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state, ready]);

  const update = useCallback((fn: (s: Persisted) => Persisted) => setState((s) => fn(s)), []);
  const enqueue = useCallback(
    (op: Op, coalesce?: (o: Op) => boolean) =>
      update((s) => ({ ...s, outbox: [...(coalesce ? s.outbox.filter((o) => !coalesce(o)) : s.outbox), op] })),
    [update],
  );

  const syncing$ = useRef(false);
  const sync = useCallback(async () => {
    const s = ref.current;
    if (!s.token || syncing$.current) return;
    syncing$.current = true;
    setSyncing(true);
    setError(null);
    const auth = { Authorization: `Bearer ${s.token}` };
    try {
      // 1. Files first: ops can refer to them.
      for (const f of s.files) {
        const part = await formPart(f.id, f.contentType);
        if (!part) {
          update((x) => ({ ...x, files: x.files.filter((y) => y.id !== f.id) }));
          continue;
        }
        const body = new FormData();
        body.append("id", f.id);
        body.append("bookingId", f.bookingId);
        body.append("kind", f.kind);
        body.append("category", f.category ?? "");
        body.append("surveyKind", f.surveyKind ?? "");
        body.append("file", part as Blob, `${f.id}.${f.contentType === "image/png" ? "png" : "jpg"}`);
        const res = await fetch(`${API_URL}/api/app/files`, { method: "POST", headers: auth, body });
        if (res.status === 401) throw new Error("signed_out");
        if (!res.ok && res.status < 500) {
          update((x) => ({ ...x, files: x.files.filter((y) => y.id !== f.id) }));
          continue;
        }
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        update((x) => ({ ...x, files: x.files.filter((y) => y.id !== f.id) }));
      }
      // 2. Ops, in order.
      const ops = ref.current.outbox;
      if (ops.length) {
        const res = await fetch(`${API_URL}/api/app/sync`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ ops }) });
        if (res.status === 401) throw new Error("signed_out");
        if (!res.ok) throw new Error(`Sync failed (${res.status})`);
        const { results } = (await res.json()) as { results: { opId: string; ok: boolean; error?: string }[] };
        const done = new Set(results.map((r) => r.opId));
        update((x) => ({ ...x, outbox: x.outbox.filter((o) => !done.has(o.opId)) }));
        const failed = results.filter((r) => !r.ok);
        if (failed.length) setError(`${failed.length} change${failed.length === 1 ? "" : "s"} couldn't be saved: ${failed[0]!.error}`);
      }
      // 3. Fresh jobs.
      const res = await fetch(`${API_URL}/api/app/jobs`, { headers: auth });
      if (res.status === 401) throw new Error("signed_out");
      if (!res.ok) throw new Error(`Couldn't load jobs (${res.status})`);
      const bundle = (await res.json()) as Bundle;
      update((x) => ({ ...x, bundle, lastSyncAt: now() }));
      setOnline(true);
    } catch (e) {
      if (e instanceof Error && e.message === "signed_out") {
        update((x) => ({ ...x, token: null }));
        setError("Please sign in again. Your captures are kept on this phone.");
      } else if (e instanceof TypeError) {
        // fetch couldn't reach the server: treat as offline, keep everything queued.
        setOnline(false);
      } else setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      syncing$.current = false;
      setSyncing(false);
    }
  }, [update]);

  // Sync when connectivity returns, every 30s, and shortly after each capture.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((n) => {
      const isOnline = n.isConnected !== false;
      setOnline(isOnline);
      if (isOnline) void sync();
    });
    const t = setInterval(() => void sync(), 30_000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [sync]);
  const pendingCount = state.outbox.length + state.files.length;
  useEffect(() => {
    if (!ready || !state.token || !online || pendingCount === 0) return;
    const t = setTimeout(() => void sync(), 800);
    return () => clearTimeout(t);
  }, [pendingCount, online, ready, state.token, sync]);
  useEffect(() => {
    if (ready && state.token) void sync();
  }, [ready, state.token, sync]);

  const store = useMemo<Store>(() => {
    const capture: Store["capture"] = (bookingId, stepId, patch) => {
      const prev = ref.current.local.checklist[bookingId]?.[stepId] ?? ref.current.bundle?.jobs.find((j) => j.id === bookingId)?.captured.find((c) => c.templateId === stepId);
      const next: Captured = {
        id: prev?.id ?? randomUUID(),
        templateId: stepId,
        done: prev?.done ?? false,
        serial: prev?.serial ?? null,
        readings: prev?.readings ?? {},
        note: prev?.note ?? null,
        photoFileIds: prev?.photoFileIds ?? [],
        ...patch,
        capturedAt: now(),
      };
      update((s) => ({ ...s, local: { ...s.local, checklist: { ...s.local.checklist, [bookingId]: { ...s.local.checklist[bookingId], [stepId]: next } } } }));
      enqueue({ opId: randomUUID(), type: "checklist_item", bookingId, ...next }, (o) => o.type === "checklist_item" && o.id === next.id);
    };
    return {
      ...state,
      ready,
      online,
      status: !online ? "offline" : syncing ? "syncing" : error ? "error" : state.outbox.length + state.files.length ? "pending" : "synced",
      error,
      async signIn(token) {
        update((s) => ({ ...s, token }));
      },
      async signOut() {
        update(() => EMPTY);
      },
      sync,
      capture,
      async addPhoto(bookingId, source, contentType, category, surveyKind = null) {
        const id = randomUUID();
        await saveBlob(id, source, contentType);
        update((s) => ({
          ...s,
          local: { ...s.local, photos: { ...s.local.photos, [id]: { contentType, bookingId, category, surveyKind } } },
          files: [...s.files, { id, bookingId, kind: "photo", category, surveyKind, contentType }],
        }));
        return id;
      },
      setSurveyField(surveyId, key, value) {
        update((s) => ({ ...s, local: { ...s.local, survey: { ...s.local.survey, [surveyId]: { ...s.local.survey[surveyId], [key]: value } } } }));
        enqueue({ opId: randomUUID(), type: "survey_field", surveyId, key, value, capturedAt: now() }, (o) => o.type === "survey_field" && o.surveyId === surveyId && o.key === key);
      },
      setStatus(bookingId, status) {
        update((s) => ({ ...s, local: { ...s.local, status: { ...s.local.status, [bookingId]: status } } }));
        enqueue({ opId: randomUUID(), type: "booking_status", bookingId, status, capturedAt: now() });
      },
      async signOff(bookingId, name, signaturePaths) {
        update((s) => ({ ...s, local: { ...s.local, signoff: { ...s.local.signoff, [bookingId]: { name, signatureFileId: null } }, status: { ...s.local.status, [bookingId]: "completed" } } }));
        enqueue({ opId: randomUUID(), type: "signoff", bookingId, name, signaturePaths, capturedAt: now() });
      },
      setKitChecked(kitId, checked) {
        update((s) => ({ ...s, local: { ...s.local, kitChecked: { ...s.local.kitChecked, [kitId]: checked } } }));
      },
      reportKit(kitId, issue, note) {
        enqueue({ opId: randomUUID(), type: "kit_issue", kitItemId: kitId, issue, note, capturedAt: now() });
      },
      onMyWay(bookingId, etaMinutes) {
        enqueue({ opId: randomUUID(), type: "on_my_way", bookingId, etaMinutes, capturedAt: now() });
      },
      respond(job, response, reason) {
        update((s) => ({ ...s, local: { ...s.local, responses: { ...(s.local.responses ?? {}), [job.id]: { response, reason, forStartsAt: job.startsAt } } } }));
        // Only the latest answer for a job needs sending.
        enqueue({ opId: randomUUID(), type: "booking_response", bookingId: job.id, response, reason, capturedAt: now() }, (o) => o.type === "booking_response" && o.bookingId === job.id);
      },
    };
  }, [state, ready, online, syncing, error, update, enqueue, sync]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** My answer to a job for its current dates: this phone's if newer, else the server's. */
export function useMyResponse(job: Pick<Job, "id" | "startsAt" | "myResponse">): JobResponse | null {
  const s = useStore();
  const mine = s.local.responses?.[job.id];
  if (mine && mine.forStartsAt === job.startsAt) return mine;
  return job.myResponse ? { response: job.myResponse.response, reason: job.myResponse.reason } : null;
}

/** Captured state for a step: the phone's copy if there is one, else the server's. */
export function useCapture(bookingId: string, stepId: string): Captured | undefined {
  const s = useStore();
  return s.local.checklist[bookingId]?.[stepId] ?? s.bundle?.jobs.find((j) => j.id === bookingId)?.captured.find((c) => c.templateId === stepId);
}

export { removeBlob };
