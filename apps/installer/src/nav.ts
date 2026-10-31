export type Route =
  | { name: "jobs" }
  | { name: "messages" }
  | { name: "alerts" }
  | { name: "chat"; projectId: string }
  | { name: "van" }
  | { name: "profile" }
  | { name: "job"; id: string }
  | { name: "survey"; id: string }
  | { name: "checklist"; id: string }
  | { name: "signoff"; id: string };

export interface Nav {
  route: Route;
  push(r: Route): void;
  back(): void;
  tab(r: Route): void;
}
