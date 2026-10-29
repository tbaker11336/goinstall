"use client";

import type { AddressSuggestion } from "@goinstall/integrations";
import { MapPin, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { suggestAddressesAction } from "@/lib/actions/site";

const newToken = () => crypto.randomUUID();

/**
 * The design map's search box: UK address suggestions from Google as you
 * type (arrow keys and Enter, or click), or type a postcode and press Go.
 */
export function AddressSearch({ searching, onSearch }: { searching: boolean; onSearch: (query: string, place?: { placeId: string; sessionToken: string }) => void }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const token = useRef(newToken());
  const latest = useRef(0);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setError(null);
      return;
    }
    const n = ++latest.current;
    const t = setTimeout(async () => {
      const r = await suggestAddressesAction(q, token.current);
      if (n !== latest.current) return; // a newer keystroke won
      setSuggestions(r.suggestions ?? []);
      setError(r.error ?? null);
      setActive(-1);
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

  function choose(s: AddressSuggestion) {
    const label = [s.main, s.secondary].filter(Boolean).join(", ");
    latest.current++; // ignore suggestions still on their way
    setValue(label);
    setSuggestions([]);
    setOpen(false);
    onSearch(label, { placeId: s.placeId, sessionToken: token.current });
    token.current = newToken(); // a pick ends Google's billing session
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (open && active >= 0 && suggestions[active]) return choose(suggestions[active]);
    setOpen(false);
    if (value.trim().length >= 2) onSearch(value.trim());
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  const showList = open && (suggestions.length > 0 || Boolean(error));
  return (
    <form onSubmit={submit} role="search" className="flex items-center gap-2 border-b px-4 py-2.5">
      <label htmlFor="map-search" className="sr-only">
        Search the map by postcode or address
      </label>
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="map-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Search postcode or address"
          autoComplete="off"
          className="h-10 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm"
        />
        {showList && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-md border bg-card shadow-lg">
            <ul id={listId} role="listbox" aria-label="Address suggestions">
              {suggestions.map((s, i) => (
                <li
                  key={s.placeId}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // Keep focus in the box so the click lands before blur closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm ${i === active ? "bg-accent-tint" : ""}`}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="font-medium">{s.main}</span>
                    {s.secondary && <span className="block text-xs text-muted-foreground">{s.secondary}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {error ? (
              <p className="px-3 py-2 text-xs text-destructive">{error} You can still type a postcode and press Go.</p>
            ) : (
              <p className="border-t px-3 py-1.5 text-right text-[11px] text-muted-foreground">Powered by Google</p>
            )}
          </div>
        )}
      </div>
      <button type="submit" disabled={searching || value.trim().length < 2} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {searching ? "Finding…" : "Go"}
      </button>
    </form>
  );
}
