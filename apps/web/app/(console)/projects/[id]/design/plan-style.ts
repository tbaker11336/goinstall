import type { CableKind, MarkerKind } from "@goinstall/core";

/** One colour per string on the plan (outline and number), in string order. */
export const STRING_COLOURS = ["#2a78d6", "#eb6834", "#12a150", "#a855f7", "#e5b100", "#0ea5b7", "#d6336c", "#8b5e34"] as const;
export const stringColour = (n: number) => STRING_COLOURS[(n - 1) % STRING_COLOURS.length]!;

export const CABLE_COLOURS: Record<CableKind, string> = { dc: "#e5484d", ac: "#2a78d6", battery: "#a855f7", ev: "#12a150", data: "#e5b100" };

export const MARKER_COLOURS: Record<MarkerKind, string> = {
  meter_box: "#101828",
  distribution_board: "#344054",
  ev_charger: "#12a150",
  battery: "#a855f7",
  inverter: "#2a78d6",
  scaffold: "#DC6803",
  note: "#e5b100",
};
