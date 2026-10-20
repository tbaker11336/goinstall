import { CONTACT_STAGES, type ContactStage } from "@goinstall/core";
import { ArrowDown, ArrowUp, Columns3, List, Plus } from "lucide-react";
import Link from "next/link";
import { ContactsKanban } from "@/components/contacts-kanban";
import { ContactStageChip, EmptyState, PageHeader, PRODUCTS, productLabel, ProductTags, type Product } from "@/components/domain";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { setContactsViewAction } from "@/lib/actions/crm";
import { asUser } from "@/lib/auth";
import { listContacts, listSources, listStaff, type ContactRow } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

export const metadata = { title: "Contacts" };

type SearchParams = { q?: string; product?: string; source?: string; owner?: string; stage?: string; sort?: string; dir?: string };

const SORTS: Record<string, (c: ContactRow) => string | number> = {
  name: (c) => c.name.toLowerCase(),
  town: (c) => (c.town ?? "").toLowerCase(),
  source: (c) => (c.source ?? "").toLowerCase(),
  owner: (c) => (c.owner_name ?? "").toLowerCase(),
  stage: (c) => CONTACT_STAGES.indexOf(c.stage),
  activity: (c) => new Date(c.last_activity_at).getTime(),
};

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const product = PRODUCTS.includes(sp.product as Product) ? (sp.product as Product) : undefined;
  const stage = (CONTACT_STAGES as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as ContactStage) : undefined;
  const owner = sp.owner && /^[0-9a-f-]{36}$/.test(sp.owner) ? sp.owner : undefined;

  const { contacts, staff, sources, view } = await asUser(async (tx, session) => {
    const [contacts, staff, sources, me] = await Promise.all([
      listContacts(tx, { q: sp.q?.trim() || undefined, product, source: sp.source || undefined, owner, stage }),
      listStaff(tx),
      listSources(tx),
      tx.selectFrom("users").select("preferences").where("id", "=", session.userId).executeTakeFirstOrThrow(),
    ]);
    const prefs = (me.preferences ?? {}) as { contacts_view?: string };
    return { contacts, staff, sources, view: prefs.contacts_view === "list" ? "list" : "kanban" };
  });

  const filtered = Boolean(sp.q || product || sp.source || owner || stage);

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"}${filtered ? " matching filters" : ""}`}
        actions={
          <>
            <div role="group" aria-label="View" className="flex rounded-md border bg-card p-0.5">
              {(["kanban", "list"] as const).map((v) => (
                <form key={v} action={setContactsViewAction.bind(null, v)}>
                  <Button type="submit" size="sm" variant={view === v ? "secondary" : "ghost"} aria-pressed={view === v}>
                    {v === "kanban" ? <Columns3 aria-hidden /> : <List aria-hidden />}
                    {v === "kanban" ? "Kanban" : "List"}
                  </Button>
                </form>
              ))}
            </div>
            <Link href="/contacts/new" className={buttonVariants()}>
              <Plus aria-hidden /> New enquiry
            </Link>
          </>
        }
      />

      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/contacts">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Search
          <Input name="q" defaultValue={sp.q} placeholder="Name, address, phone or email" className="w-64" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Product
          <Select name="product" defaultValue={product ?? ""} className="w-36">
            <option value="">Any</option>
            {PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {productLabel(p)}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Source
          <Select name="source" defaultValue={sp.source ?? ""} className="w-36">
            <option value="">Any</option>
            {sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Owner
          <Select name="owner" defaultValue={owner ?? ""} className="w-40">
            <option value="">Anyone</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </Select>
        </label>
        {stage && <input type="hidden" name="stage" value={stage} />}
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered && (
          <Link href="/contacts" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </form>

      {view === "kanban" ? (
        <ContactsKanban contacts={contacts} />
      ) : (
        <ContactsList contacts={contacts} sp={sp} />
      )}
    </>
  );
}

function ContactsList({ contacts, sp }: { contacts: ContactRow[]; sp: SearchParams }) {
  const sortKey = sp.sort && sp.sort in SORTS ? sp.sort : "activity";
  const dir = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : sortKey === "activity" ? "desc" : "asc";
  const key = SORTS[sortKey]!;
  const rows = [...contacts].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
  });

  if (!rows.length) return <EmptyState>No contacts match.</EmptyState>;

  const header = (k: keyof typeof SORTS, label: string) => {
    const active = sortKey === k;
    const params = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    params.set("sort", k);
    params.set("dir", active && dir === "asc" ? "desc" : "asc");
    return (
      <th scope="col" className="px-3 py-2 font-medium" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={`/contacts?${params}`} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
          {label}
          {active && (dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
        </Link>
      </th>
    );
  };

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            {header("name", "Name")}
            {header("town", "Town / postcode")}
            <th scope="col" className="px-3 py-2 font-medium">
              Products
            </th>
            {header("source", "Source")}
            {header("stage", "Stage")}
            {header("owner", "Owner")}
            {header("activity", "Last activity")}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="relative border-b last:border-0 hover:bg-muted/60">
              <td className="px-3 py-2">
                <Link href={`/contacts/${c.id}`} className="font-medium after:absolute after:inset-0">
                  {c.name}
                </Link>
                {c.status && <span className="block max-w-72 truncate text-xs text-muted-foreground">{c.status}</span>}
              </td>
              <td className="px-3 py-2">{[c.town, c.postcode].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-3 py-2">
                <ProductTags products={c.interested_in} />
              </td>
              <td className="px-3 py-2">{c.source ?? "—"}</td>
              <td className="px-3 py-2">
                <ContactStageChip stage={c.stage} />
              </td>
              <td className="px-3 py-2">{c.owner_name ?? "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{timeAgo(c.last_activity_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

