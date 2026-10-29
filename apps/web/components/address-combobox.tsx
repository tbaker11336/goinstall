"use client";

import type { AddressSuggestion } from "@goinstall/integrations";
import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { suggestAddressesAction } from "@/lib/actions/site";

const newToken = () => crypto.randomUUID();

export interface PickedPlace {
  placeId: string;
  /** Google bills the typing and the chosen place's lookup as one session. */
  sessionToken: string;
  label: string;
}

/**
 * A text box with UK address suggestions from Google as you type: arrow
 * keys and Enter, or click, to pick one. Enter with nothing highlighted is
 * left to the surrounding form. Typing freely still works (no key, or
 * Google down, means no suggestions, not a broken field).
 */
export function AddressCombobox({
  id,
  value,
  onChange,
  onPick,
  className,
  ...input
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (place: PickedPlace) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id" | "className">) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const token = useRef(newToken());
  const latest = useRef(0);
  const typed = useRef(false);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    // Only look up what the user typed, not a value filled in by a pick.
    if (!typed.current || q.length < 3) {
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
    latest.current++; // ignore suggestions still on their way
    typed.current = false;
    setSuggestions([]);
    setOpen(false);
    onPick({ placeId: s.placeId, sessionToken: token.current, label: [s.main, s.secondary].filter(Boolean).join(", ") });
    token.current = newToken(); // a pick ends Google's billing session
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
    } else if (e.key === "Enter" && open && active >= 0 && suggestions[active]) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Enter") setOpen(false);
  }

  const showList = open && (suggestions.length > 0 || Boolean(error));
  return (
    <div className="relative">
      <input
        {...input}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className={className}
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
            <p className="px-3 py-2 text-xs text-destructive">{error} You can still type the address in full.</p>
          ) : (
            <p className="border-t px-3 py-1.5 text-right text-[11px] text-muted-foreground">Powered by Google</p>
          )}
        </div>
      )}
    </div>
  );
}
