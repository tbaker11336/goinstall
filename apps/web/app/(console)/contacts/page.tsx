import { CONTACT_STAGES, type ContactStage } from "@goinstall/core";
import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import Link from "next/link";
import { ContactsKanban } from "@/components/contacts-kanban";
import { Avatar, ContactStageChip, EmptyState, PageHeader, PRODUCTS, productLabel, ProductTags, type Product } from "@/components/domain";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { setContactsViewAction } from "@/lib/actions/crm";
import { asUser } from "@/lib/auth";
import { listContacts, listSources, listStaff, type ContactRow } from "@/lib/queries";
import { cn, formatMoney, timeAgo } from "@/lib/utils";

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
  const open = contacts.filter((c) => c.stage !== "lost" && c.stage !== "won");
  const pipeline = open.reduce((n, c) => n + Number(c.value ?? 0), 0);
  const pipelineText = pipeline >= 1000 ? `£${Math.round(pipeline / 1000)}k` : formatMoney(pipeline);

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${open.length} open · ${pipelineText} in pipeline${filtered ? " · filtered" : ""}`}
        actions={
          <>
            <div role="group" aria-label="View" className="flex rounded-[9px] bg-divider p-[3px]">
              {(["list", "kanban"] as const).map((v) => (
                <form key={v} action={setContactsViewAction.bind(null, v)}>
                  <button
                    type="submit"
                    aria-pressed={view === v}
                    className={cn(
                      "h-[34px] rounded-[7px] px-3.5 text-[13px] font-semibold text-ink-3 hover:text-foreground",
                      view === v && "bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]",
                    )}
                  >
                    {v === "kanban" ? "Kanban" : "List"}
                  </button>
                </form>
              ))}
            </div>
            <Link href="/contacts/new" className={buttonVariants()}>
              <Plus className="size-[18px]" strokeWidth={2} aria-hidden /> New contact
            </Link>
          </>
        }
      />

      <form role="search" className="mb-5 flex flex-wrap items-center gap-2.5" action="/contacts">
        <div className="relative flex max-w-[360px] flex-[1_1_260px] items-center">
          <Search className="pointer-events-none absolute left-3 size-[18px] text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <label htmlFor="contact-search" className="sr-only">
            Search
          </label>
          <Input id="contact-search" name="q" type="search" defaultValue={sp.q} placeholder="Search name, address or phone" className="pl-[38px]" />
        </div>
        <label htmlFor="f-product" className="sr-only">
          Product
        </label>
        <Select id="f-product" name="product" defaultValue={product ?? ""} className="w-auto">
          <option value="">All products</option>
          {PRODUCTS.map((p) => (
            <option key={p} value={p}>
              {productLabel(p)}
            </option>
          ))}
        </Select>
        <label htmlFor="f-source" className="sr-only">
          Source
        </label>
        <Select id="f-source" name="source" defaultValue={sp.source ?? ""} className="w-auto">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <label htmlFor="f-owner" className="sr-only">
          Owner
        </label>
        <Select id="f-owner" name="owner" defaultValue={owner ?? ""} className="w-auto">
          <option value="">Anyone</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </Select>
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
      <th scope="col" className="bg-surface-subtle px-3.5 py-2.5 font-semibold" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
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
        <thead className="text-left text-[12.5px] text-ink-3">
          <tr className="border-b">
            {header("name", "Name")}
            {header("town", "Town / postcode")}
            <th scope="col" className="bg-surface-subtle px-3.5 py-2.5 font-semibold">
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
            <tr key={c.id} className="relative border-b border-divider last:border-0 hover:bg-surface-subtle">
              <td className="px-3.5 py-3">
                <Link href={`/contacts/${c.id}`} className="font-medium after:absolute after:inset-0">
                  {c.name}
                </Link>
                {c.status && <span className="block max-w-72 truncate text-xs text-muted-foreground">{c.status}</span>}
              </td>
              <td className="px-3.5 py-3">{[c.town, c.postcode].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-3.5 py-3">
                <ProductTags products={c.interested_in} />
              </td>
              <td className="px-3.5 py-3">{c.source ?? "—"}</td>
              <td className="px-3.5 py-3">
                <ContactStageChip stage={c.stage} />
              </td>
              <td className="px-3.5 py-3">{c.owner_name ? <span className="inline-flex items-center gap-2"><Avatar name={c.owner_name} />{c.owner_name}</span> : "—"}</td>
              <td className="px-3.5 py-3 whitespace-nowrap text-muted-foreground">{timeAgo(c.last_activity_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

