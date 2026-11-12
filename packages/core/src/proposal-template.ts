/**
 * A company's proposal template (Settings › Proposal): a front cover and
 * the pages around the quote, in the order the company chooses. The quote
 * itself is one of the pages: it can be moved but not removed. Images are
 * company files (ids); nothing here is filled in for the company.
 */

export const TEMPLATE_PAGE_TYPES = ["quote", "about", "reviews", "featured_work", "accreditations", "text"] as const;
export type TemplatePageType = (typeof TEMPLATE_PAGE_TYPES)[number];

export const TEMPLATE_PAGE_LABELS: Record<TemplatePageType, string> = {
  quote: "Your quote",
  about: "About us",
  reviews: "Reviews",
  featured_work: "Featured work",
  accreditations: "Accreditations",
  text: "Custom page",
};

export interface Review {
  name: string;
  location: string | null;
  /** 1–5 stars, or none. */
  rating: number | null;
  text: string;
}

export interface WorkItem {
  title: string;
  description: string | null;
  photoFileId: string | null;
}

export interface Accreditation {
  name: string;
  /** Membership or certificate number. */
  number: string | null;
  logoFileId: string | null;
}

export interface TemplatePage {
  id: string;
  type: TemplatePageType;
  enabled: boolean;
  /** Heading on the page; the type's label when blank. */
  title: string | null;
  /** Reviews: a line under the heading (e.g. "4.9 on Google from 120 reviews") and a link. Custom page: the text. */
  intro: string | null;
  link: string | null;
  reviews: Review[];
  work: WorkItem[];
  accreditations: Accreditation[];
}

export interface ProposalTemplate {
  cover: {
    enabled: boolean;
    /** e.g. "Your solar proposal". {first_name}, {name} and {address} are filled in. */
    headline: string | null;
    subheading: string | null;
    imageFileId: string | null;
  };
  pages: TemplatePage[];
}

export const TEMPLATE_LIMITS = { pages: 12, reviews: 12, work: 12, accreditations: 12, text: 4000, short: 160 } as const;

const page = (type: TemplatePageType, enabled: boolean): TemplatePage => ({ id: type, type, enabled, title: null, intro: null, link: null, reviews: [], work: [], accreditations: [] });

/** A new company's template: a cover, then the quote, then About us. The rest wait to be filled in. */
export function defaultTemplate(): ProposalTemplate {
  return {
    cover: { enabled: true, headline: null, subheading: null, imageFileId: null },
    pages: [page("quote", true), page("about", true), page("reviews", false), page("featured_work", false), page("accreditations", false)],
  };
}

const str = (v: unknown, max: number = TEMPLATE_LIMITS.short): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
};
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const url = (v: unknown) => {
  const s = str(v, 500);
  return s && /^https:\/\/[^\s]+$/i.test(s) ? s : null;
};

/**
 * Clean whatever's stored or sent: unknown keys dropped, text trimmed and
 * capped, lists limited, the quote page always present exactly once.
 */
export function normaliseTemplate(raw: unknown): ProposalTemplate {
  const d = defaultTemplate();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const c = (r.cover && typeof r.cover === "object" ? r.cover : {}) as Record<string, unknown>;
  const cover = { enabled: c.enabled !== false, headline: str(c.headline), subheading: str(c.subheading, 300), imageFileId: uuid(c.imageFileId) };
  const ids = new Set<string>();
  const pages: TemplatePage[] = [];
  for (const p of Array.isArray(r.pages) ? r.pages : []) {
    if (!p || typeof p !== "object") continue;
    const x = p as Record<string, unknown>;
    const type = TEMPLATE_PAGE_TYPES.includes(x.type as TemplatePageType) ? (x.type as TemplatePageType) : null;
    if (!type) continue;
    if (type !== "text" && pages.some((q) => q.type === type)) continue;
    let id = str(x.id, 40) ?? type;
    while (ids.has(id)) id = `${id}-${ids.size}`;
    ids.add(id);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((i) => i && typeof i === "object") : []) as Record<string, unknown>[];
    pages.push({
      id,
      type,
      enabled: type === "quote" ? true : x.enabled !== false,
      title: str(x.title),
      intro: str(x.intro, type === "text" ? TEMPLATE_LIMITS.text : 300),
      link: url(x.link),
      reviews:
        type === "reviews"
          ? list(x.reviews)
              .map((v) => ({ name: str(v.name) ?? "", location: str(v.location), rating: typeof v.rating === "number" && v.rating >= 1 && v.rating <= 5 ? Math.round(v.rating) : null, text: str(v.text, 1000) ?? "" }))
              .filter((v) => v.name || v.text)
              .slice(0, TEMPLATE_LIMITS.reviews)
          : [],
      work:
        type === "featured_work"
          ? list(x.work)
              .map((v) => ({ title: str(v.title) ?? "", description: str(v.description, 500), photoFileId: uuid(v.photoFileId) }))
              .filter((v) => v.title || v.photoFileId)
              .slice(0, TEMPLATE_LIMITS.work)
          : [],
      accreditations:
        type === "accreditations"
          ? list(x.accreditations)
              .map((v) => ({ name: str(v.name) ?? "", number: str(v.number, 60), logoFileId: uuid(v.logoFileId) }))
              .filter((v) => v.name || v.logoFileId)
              .slice(0, TEMPLATE_LIMITS.accreditations)
          : [],
    });
    if (pages.length >= TEMPLATE_LIMITS.pages) break;
  }
  if (!pages.some((p) => p.type === "quote")) pages.unshift(page("quote", true));
  if (!Array.isArray(r.pages)) return { cover, pages: d.pages };
  return { cover, pages };
}

/** The pages a customer sees: switched on and with something on them. */
export function visiblePages(t: ProposalTemplate, has: { about: boolean }): TemplatePage[] {
  return t.pages.filter((p) => {
    if (!p.enabled) return false;
    switch (p.type) {
      case "quote":
        return true;
      case "about":
        return has.about;
      case "reviews":
        return p.reviews.length > 0;
      case "featured_work":
        return p.work.length > 0;
      case "accreditations":
        return p.accreditations.length > 0;
      case "text":
        return Boolean(p.intro);
    }
  });
}

export const pageTitle = (p: TemplatePage) => p.title ?? TEMPLATE_PAGE_LABELS[p.type];

/** The cover's headline with the customer's details filled in. */
export function coverHeadline(t: ProposalTemplate, v: { firstName: string; name: string; address: string | null; fallback: string }): string {
  if (!t.cover.headline) return v.fallback;
  return t.cover.headline.replace(/\{first_name\}/g, v.firstName).replace(/\{name\}/g, v.name).replace(/\{address\}/g, v.address ?? "your home");
}

/** Every image the template uses, to sign or load in one go. */
export function templateFileIds(t: ProposalTemplate): string[] {
  return [t.cover.imageFileId, ...t.pages.flatMap((p) => [...p.work.map((w) => w.photoFileId), ...p.accreditations.map((a) => a.logoFileId)])].filter((x): x is string => Boolean(x));
}
