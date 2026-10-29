"use client";

import { useState } from "react";
import { AddressCombobox } from "@/components/address-combobox";
import { Field, fieldClass, Input } from "@/components/ui/input";
import { addressDetailsAction } from "@/lib/actions/site";

export interface AddressValues {
  address_line1?: string | null;
  address_line2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
}

const inputClass = `${fieldClass} h-10`;

/**
 * Address, line 2, town and postcode. Start typing in Address for Google's
 * suggestions; picking one fills the rest (and, with `withLocation`, the
 * map position as hidden lat/lng fields). Every field stays editable.
 */
export function AddressFields({ values = {}, withLocation = false }: { values?: AddressValues; withLocation?: boolean }) {
  const [v, setV] = useState({
    address_line1: values.address_line1 ?? "",
    address_line2: values.address_line2 ?? "",
    town: values.town ?? "",
    county: values.county ?? "",
    postcode: values.postcode ?? "",
  });
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A hand edit after a pick may move the address: drop the picked position.
  const set = (k: keyof typeof v) => (value: string) => {
    setV((s) => ({ ...s, [k]: value }));
    if (k !== "address_line2") setAt(null);
  };

  return (
    <>
      <Field label="Address" htmlFor="address_line1" className="sm:col-span-2" hint="Start typing to choose from Google's address list, or type it in full.">
        <AddressCombobox
          id="address_line1"
          name="address_line1"
          value={v.address_line1}
          onChange={set("address_line1")}
          onPick={async (p) => {
            setV((s) => ({ ...s, address_line1: p.label.split(",")[0] ?? p.label }));
            const r = await addressDetailsAction(p.placeId, p.sessionToken);
            if (!r.parts) return setNote(r.error ?? null);
            setNote(null);
            setV({ address_line1: r.parts.line1, address_line2: r.parts.line2, town: r.parts.town, county: r.parts.county, postcode: r.parts.postcode });
            setAt(r.at ?? null);
          }}
          className={inputClass}
        />
      </Field>
      {note && <p className="-mt-2 text-xs text-destructive sm:col-span-2">{note}</p>}
      <Field label="Address line 2" htmlFor="address_line2" className="sm:col-span-2">
        <Input id="address_line2" name="address_line2" value={v.address_line2} onChange={(e) => set("address_line2")(e.target.value)} />
      </Field>
      <Field label="Town" htmlFor="town">
        <Input id="town" name="town" value={v.town} onChange={(e) => set("town")(e.target.value)} />
      </Field>
      <Field label="Postcode" htmlFor="postcode">
        <Input id="postcode" name="postcode" value={v.postcode} onChange={(e) => set("postcode")(e.target.value)} autoCapitalize="characters" />
      </Field>
      <input type="hidden" name="county" value={v.county} />
      {withLocation && at && (
        <>
          <input type="hidden" name="lat" value={at.lat} />
          <input type="hidden" name="lng" value={at.lng} />
        </>
      )}
    </>
  );
}
