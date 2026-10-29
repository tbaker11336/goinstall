"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { AddressCombobox } from "@/components/address-combobox";

/**
 * The design map's search box: pick a Google address suggestion, or type a
 * postcode and press Go.
 */
export function AddressSearch({ searching, onSearch }: { searching: boolean; onSearch: (query: string, place?: { placeId: string; sessionToken: string }) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length >= 2) onSearch(value.trim());
      }}
      role="search"
      className="flex items-center gap-2 border-b px-4 py-2.5"
    >
      <label htmlFor="map-search" className="sr-only">
        Search the map by postcode or address
      </label>
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <AddressCombobox
          id="map-search"
          type="search"
          value={value}
          onChange={setValue}
          onPick={(p) => {
            setValue(p.label);
            onSearch(p.label, { placeId: p.placeId, sessionToken: p.sessionToken });
          }}
          placeholder="Search postcode or address"
          className="h-10 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm"
        />
      </div>
      <button type="submit" disabled={searching || value.trim().length < 2} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {searching ? "Finding…" : "Go"}
      </button>
    </form>
  );
}
