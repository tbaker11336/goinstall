// Adapter interfaces for third-party services. Each integration sits behind
// an interface here so the app never depends on a provider directly.
export * from "./email";
export * from "./storage";
export * from "./suppliers";
export * from "./pvgis";
export * from "./google";
export * from "./payments";
export * from "./accounting";
