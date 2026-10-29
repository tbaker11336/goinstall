import { PRODUCTS, productLabel, SOURCES, type Product } from "@/components/domain";
import { AddressFields } from "@/components/address-fields";
import { Field, Input, Select } from "@/components/ui/input";

interface ContactValues {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
  source?: string | null;
  owner_id?: string | null;
}

export function ProductCheckboxes({ name = "products", selected = [], legend = "Interested in" }: { name?: string; selected?: readonly Product[]; legend?: string }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-4">
        {PRODUCTS.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={p} defaultChecked={selected.includes(p)} className="size-4 accent-primary" />
            {productLabel(p)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ContactFields({
  values = {},
  staff,
  extraSources = [],
  withLocation = false,
}: {
  values?: ContactValues;
  staff: { id: string; full_name: string }[];
  extraSources?: string[];
  /** New enquiries: a picked Google address also sets the project's map position. */
  withLocation?: boolean;
}) {
  const sources = [...new Set([...SOURCES, ...extraSources, ...(values.source ? [values.source] : [])])];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="name" className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={values.name} required autoComplete="off" />
      </Field>
      <Field label="Phone" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={values.phone ?? ""} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
      </Field>
      <AddressFields values={values} withLocation={withLocation} />
      <Field label="Source" htmlFor="source">
        <Select id="source" name="source" defaultValue={values.source ?? ""}>
          <option value="">Not known</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </Field>
      <Field label="Owner" htmlFor="owner_id">
        <Select id="owner_id" name="owner_id" defaultValue={values.owner_id ?? ""}>
          <option value="">Me</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
