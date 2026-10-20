import {
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  FileCheck2,
  MessagesSquare,
  Minus,
  Package,
  Palette,
  PlugZap,
  ReceiptText,
  Smartphone,
  Sun,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/sidebar";
import { getAuthUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "GoInstall · Software for solar, battery and EV charger installers" },
  description: "CRM, solar and EV design, proposals, supplier orders, an installer app and DNO paperwork in one place. Enter a job once and it carries through to handover.",
};

const DEMO_EMAIL = "mailto:hello@goinstall.io?subject=GoInstall%20demo";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const INTEGRATIONS = ["Xero", "Stripe", "Google Calendar", "Outlook", "Gmail", "Your suppliers"];

const FEATURES = [
  { icon: MessagesSquare, title: "CRM and messaging", body: "A Kanban pipeline from enquiry to won. Email customers from the contact page and keep every message, note and update in one thread." },
  { icon: Sun, title: "Solar design", body: "The roof loads from the address. Place panels, pick kit from your catalogue and get the MCS figure with a PVGIS cross-check." },
  { icon: PlugZap, title: "EV charger design", body: "Place the charger and supply, draw the cable route and check cable size, volt drop and maximum demand against your rules." },
  { icon: ReceiptText, title: "Proposals and payments", body: "Branded proposals built from the design. Customers accept and sign online and pay the deposit by card." },
  { icon: Package, title: "Supplier ordering", body: "Compare prices and stock across suppliers, see your margin, and send one purchase order per supplier." },
  { icon: Smartphone, title: "Installer app", body: "Jobs, site surveys, install checklists with photo evidence, test readings and customer sign-off, even offline." },
  { icon: CalendarDays, title: "Scheduling", body: "Book installs, scaffold and electricians on a week calendar with clash warnings, synced to your team's calendars." },
  { icon: FileCheck2, title: "DNO and MCS paperwork", body: "G98, G99, EV notifications, MCS certificates and handover packs, pre-filled from the survey, design and install." },
  { icon: Palette, title: "Your brand, your catalogue", body: "Your logo, colours and T&Cs on every proposal. Your products and prices, from price files or supplier connections." },
];

const STEPS = [
  { title: "Enquiry", body: "A web form, call or referral becomes a contact and a project in one step." },
  { title: "Survey", body: "Send the online survey link; answers and photos land on the job with their source." },
  { title: "Design and propose", body: "Design solar and EV on the same job, then send a branded proposal." },
  { title: "Deposit and kit", body: "The customer signs and pays; purchase orders draft themselves from the proposal." },
  { title: "Install and hand over", body: "The installer app guides the job; paperwork and the handover pack follow." },
];

const PLANS = [
  {
    name: "Starter",
    blurb: "For small teams getting organised",
    price: "£49",
    unit: "per user / month",
    cta: "Start free trial",
    href: "/signup",
    features: ["CRM, pipeline and email", "Online survey with photos", "EV charger design", "Proposals, deposits and invoices", "Scheduling, installer app (iOS and Android)"],
  },
  {
    name: "Pro",
    blurb: "For installers doing solar, battery and EV",
    price: "£69",
    unit: "per user / month",
    cta: "Start free trial",
    href: "/signup",
    popular: true,
    features: ["Everything in Starter, plus:", "Solar and battery design", "MCS and DNO paperwork packs", "Supplier price comparison", "Purchase orders by supplier"],
  },
  {
    name: "Business",
    blurb: "For multi-team and regional installers",
    price: "Custom",
    unit: "",
    cta: "Talk to us",
    href: DEMO_EMAIL,
    features: ["Everything in Pro, plus:", "Multiple teams and depots", "Supplier API connections", "Data import from your current system", "Priority support and onboarding"],
  },
];

const FAQS = [
  { q: "Can I move my customers and jobs across from my current system?", a: "Yes. We import contacts and jobs from your current CRM or spreadsheets as part of onboarding, so you start with your pipeline in place." },
  { q: "Do I have to use a particular wholesaler?", a: "No. Add any supplier. Upload their price file, or enter prices by hand, and GoInstall compares them on every job." },
  { q: "Does the installer app work without signal?", a: "Yes. Jobs download to the phone, and photos, readings and signatures save on the device and upload when it's back online." },
  { q: "Is the solar yield MCS compliant?", a: "Yield is calculated with the MCS method from the tables you work to, with a PVGIS figure alongside as a cross-check. The MCS figure is the one quoted." },
  { q: "Where is my data stored?", a: "In the UK and EU. Each company's data is kept separate and only your team can see it." },
];

function Section({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-20 px-4 py-20 sm:px-6 md:py-24", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return <p className={cn("text-xs font-bold tracking-[0.08em] uppercase", light ? "text-[#9fd8c6]" : "text-primary")}>{children}</p>;
}

function Ticks({ items, light }: { items: string[]; light?: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((t) => (
        <li key={t} className={cn("flex gap-2.5 text-[15px]", light ? "text-white/90" : "text-ink-2")}>
          <Check className={cn("mt-0.5 size-[18px] shrink-0", light ? "text-[#9fd8c6]" : "text-primary")} strokeWidth={2.5} aria-hidden />
          {t}
        </li>
      ))}
    </ul>
  );
}

function Screenshot({ src, alt, width, height, className, priority }: { src: string; alt: string; width: number; height: number; className?: string; priority?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-[0_24px_48px_-12px_rgba(16,24,40,0.18)]", className)}>
      <Image src={src} alt={alt} width={width} height={height} priority={priority} sizes="(min-width: 1152px) 1152px, 100vw" className="h-auto w-full" />
    </div>
  );
}

export default async function HomePage() {
  const signedIn = Boolean(await getAuthUser().catch(() => null));
  return (
    <div className="bg-card text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold" aria-label="GoInstall home">
            <Logo size={30} />
            <span className="text-base tracking-[-0.01em]">GoInstall</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-sm font-medium text-ink-3 hover:text-foreground">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {signedIn ? (
              <Link href="/dashboard" className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">
                Open GoInstall <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden h-10 items-center rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-muted sm:inline-flex">
                  Log in
                </Link>
                <Link href="/signup" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">
                  Start free trial
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="overflow-hidden bg-gradient-to-b from-[#f2f8f5] to-card px-4 pt-16 sm:px-6 md:pt-24">
          <div className="mx-auto flex max-w-6xl flex-col items-center text-center">
            <Eyebrow>For solar, battery and EV charger installers</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-bold tracking-[-0.03em] text-balance sm:text-5xl md:text-[56px]">Run every install, from enquiry to handover, in one place</h1>
            <p className="mt-5 max-w-2xl text-lg text-ink-3 text-pretty">
              GoInstall brings your CRM, solar and EV design, proposals, supplier orders, installer app and DNO paperwork together. Enter a job once and it carries through to handover.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-base font-semibold text-white hover:bg-primary-hover">
                Start your free trial <ArrowRight className="size-[18px]" aria-hidden />
              </Link>
              <a href={DEMO_EMAIL} className="inline-flex h-12 items-center rounded-lg border border-input bg-card px-6 text-base font-semibold text-ink-2 hover:bg-surface-subtle">
                Book a demo
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">14-day free trial · no credit card · cancel any time</p>
            <Screenshot src="/marketing/01-dashboard.png" alt="The GoInstall dashboard: stat tiles, projects by stage, today's jobs and messages" width={2880} height={2048} priority className="mt-14 w-full max-w-5xl translate-y-0 rounded-b-none border-b-0" />
          </div>
        </section>

        {/* Integrations */}
        <section aria-labelledby="works-with" className="border-y bg-surface-subtle px-4 py-8 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
            <h2 id="works-with" className="text-sm font-medium text-muted-foreground">
              Works with the tools your team already uses
            </h2>
            <ul className="flex flex-wrap justify-center gap-x-10 gap-y-3">
              {INTEGRATIONS.map((i) => (
                <li key={i} className="text-base font-bold text-ink-3">
                  {i}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Problem */}
        <Section>
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Eyebrow>The problem</Eyebrow>
              <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Stop typing the same job in five different places</h2>
              <p className="text-lg text-ink-3">
                A typical install is spread across a CRM, a design tool, spreadsheets, supplier portals, WhatsApp and paper forms. Every hand-over is a chance to retype something, miss a
                deposit or lose the photo you needed.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["Before", "Survey notes in one app, the design in another, the quote rebuilt in a spreadsheet."],
                ["With GoInstall", "Survey feeds the design, the design builds the proposal."],
                ["Before", "Chasing deposits, then copying the kit list into every supplier's portal."],
                ["With GoInstall", "The deposit lands and purchase orders draft themselves from the proposal."],
              ].map(([tag, text], i) => (
                <div key={i} className={cn("flex flex-col gap-2 rounded-xl border p-5", tag === "Before" ? "border-warning-border bg-warning-tint" : "border-[#b7dfd3] bg-accent-tint")}>
                  <span className={cn("flex items-center gap-1.5 text-sm font-bold", tag === "Before" ? "text-warning-text" : "text-accent-strong")}>
                    {tag === "Before" ? <Minus className="size-4" aria-hidden /> : <Check className="size-4" strokeWidth={2.5} aria-hidden />}
                    {tag}
                  </span>
                  <p className={cn("text-[15px]", tag === "Before" ? "text-warning-text" : "text-accent-strong")}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Features */}
        <Section id="features" className="bg-surface-subtle">
          <div className="flex max-w-2xl flex-col gap-4">
            <Eyebrow>Features</Eyebrow>
            <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Everything an installer needs, built around the job</h2>
            <p className="text-lg text-ink-3">Each project moves from enquiry to survey, design, proposal, kit, install and paperwork, and nothing is entered twice.</p>
          </div>
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex flex-col gap-3 rounded-xl border bg-card p-6">
                <span className="inline-flex size-11 items-center justify-center rounded-[10px] bg-accent-tint text-primary" aria-hidden>
                  <f.icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="text-[17px] font-bold">{f.title}</h3>
                <p className="text-[15px] text-ink-3">{f.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* Design */}
        <Section>
          <div className="grid items-center gap-12 lg:grid-cols-[2fr_3fr]">
            <div className="flex flex-col gap-5">
              <Eyebrow>Solar and EV design</Eyebrow>
              <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Design solar and the EV charger together</h2>
              <p className="text-lg text-ink-3">Roof data loads from the address. Lay out panels, pick kit from your catalogue and the results update as you go.</p>
              <Ticks
                items={[
                  "MCS annual generation, self-consumption and PVGIS cross-check",
                  "Flags G99 when export needs it and adds the paperwork",
                  "Shows the customer EV miles from their own solar",
                  "Every change saved as a version you can go back to",
                ]}
              />
            </div>
            <Screenshot src="/marketing/07-project-solar-design.png" alt="Solar design: panels laid out on a roof, with equipment and MCS results alongside" width={2880} height={2048} />
          </div>
        </Section>

        {/* Ordering */}
        <Section className="bg-surface-subtle">
          <div className="grid items-center gap-12 lg:grid-cols-[3fr_2fr]">
            <Screenshot src="/marketing/10-project-kit-suppliers.png" alt="Kit list comparing price and stock across three suppliers, with kit cost and margin" width={2880} height={2226} className="order-last lg:order-first" />
            <div className="flex flex-col gap-5">
              <Eyebrow>Ordering</Eyebrow>
              <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Order the kit the moment the deposit lands</h2>
              <p className="text-lg text-ink-3">GoInstall builds the kit list from the accepted proposal, picks the cheapest in-stock option on each line and shows your margin before you order.</p>
              <Ticks items={["Live prices from connected suppliers, or uploaded price files", "One purchase order per supplier, delivered to site or depot", "Delivery dates tracked on the job"]} />
            </div>
          </div>
        </Section>

        {/* Installer app */}
        <section className="overflow-hidden bg-accent-deep px-4 py-20 text-white sm:px-6 md:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div className="flex flex-col gap-5">
              <Eyebrow light>Installer app</Eyebrow>
              <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Everything your team needs on site, even with no signal</h2>
              <p className="text-lg text-white/80">
                Installers see their jobs, the design and the kit list. They capture surveys and photos, scan serial numbers, record test results and get the customer&apos;s signature. Everything syncs back
                to the office when they&apos;re online.
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="Platforms">
                {["iPhone", "Android", "Works offline"].map((t) => (
                  <li key={t} className="rounded-full border border-white/25 px-3.5 py-1.5 text-sm font-semibold">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-center gap-4 sm:gap-6">
              {[
                ["/marketing/12-app-my-jobs.png", "Installer app: today's jobs"],
                ["/marketing/15-app-install-checklist.png", "Installer app: install checklist with photo steps"],
              ].map(([src, alt], i) => (
                <div key={src} className={cn("w-[44%] max-w-[240px] overflow-hidden rounded-[28px] border-[6px] border-[#062e26] bg-card shadow-2xl", i === 1 && "mt-12")}>
                  <Image src={src!} alt={alt!} width={780} height={1688} sizes="240px" className="h-auto w-full" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <Section id="how-it-works">
          <div className="flex max-w-2xl flex-col gap-4">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">One job, start to finish</h2>
          </div>
          <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="hidden h-px flex-1 bg-input lg:block" aria-hidden />
                </div>
                <h3 className="text-[17px] font-bold">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="text-[15px] text-ink-3">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Pricing */}
        <Section id="pricing" className="bg-surface-subtle">
          <div className="flex flex-col items-center gap-4 text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Simple pricing per user</h2>
            <p className="max-w-xl text-lg text-ink-3">Every plan includes the installer app, unlimited projects and UK support. Prices exclude VAT.</p>
          </div>
          <ul className="mt-12 grid items-start gap-5 md:grid-cols-3">
            {PLANS.map((p) => (
              <li key={p.name} className={cn("relative flex flex-col gap-5 rounded-xl border bg-card p-7", p.popular && "border-2 border-primary shadow-[0_12px_32px_-8px_rgba(11,122,98,0.25)]")}>
                {p.popular && <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">Most popular</span>}
                <div>
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="text-sm text-ink-3">{p.blurb}</p>
                </div>
                <p className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-[-0.02em]">{p.price}</span>
                  {p.unit && <span className="text-sm text-ink-3">{p.unit}</span>}
                </p>
                <Link
                  href={p.href}
                  className={cn(
                    "inline-flex h-11 items-center justify-center rounded-lg text-sm font-semibold",
                    p.popular ? "bg-primary text-white hover:bg-primary-hover" : "border border-input text-ink-2 hover:bg-surface-subtle",
                  )}
                >
                  {p.cta}
                </Link>
                <Ticks items={p.features} />
              </li>
            ))}
          </ul>
          <p className="mt-6 text-center text-sm text-muted-foreground">Installer app users are included for installers and subcontractors on any plan.</p>
        </Section>

        {/* FAQ */}
        <Section id="faq">
          <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-3">
              <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em] md:text-4xl">Questions installers ask</h2>
              <p className="text-ink-3">
                Can&apos;t find your answer?{" "}
                <a href={DEMO_EMAIL} className="font-semibold text-primary hover:text-accent-strong">
                  Get in touch
                </a>
                .
              </p>
            </div>
            <div className="flex flex-col divide-y divide-divider border-y">
              {FAQS.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold">
                    {f.q}
                    <span className="text-xl text-primary transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] text-ink-3">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Section>

        {/* CTA */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-2xl bg-primary px-8 py-12 text-white md:flex-row md:items-center md:px-12">
            <div>
              <h2 className="text-3xl leading-tight font-bold tracking-[-0.02em]">Spend less time on admin and more time installing</h2>
              <p className="mt-2 text-white/80">Try GoInstall free for 14 days. No card needed.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex h-12 items-center rounded-lg bg-white px-6 font-semibold text-accent-strong hover:bg-accent-tint">
                Start free trial
              </Link>
              <a href={DEMO_EMAIL} className="inline-flex h-12 items-center rounded-lg border border-white/40 px-6 font-semibold text-white hover:bg-white/10">
                Book a demo
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t px-4 py-12 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 md:flex-row md:justify-between">
          <div className="flex max-w-xs flex-col gap-3">
            <span className="flex items-center gap-2.5 font-bold">
              <Logo size={28} /> GoInstall
            </span>
            <p className="text-sm text-ink-3">Run every install, from enquiry to handover, in one place. Built for UK solar, battery and EV charger installers.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-2.5">
              <span className="font-bold">Product</span>
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="text-ink-3 hover:text-foreground">
                  {n.label}
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-bold">Company</span>
              <a href="mailto:hello@goinstall.io" className="text-ink-3 hover:text-foreground">
                Contact
              </a>
              <a href={DEMO_EMAIL} className="text-ink-3 hover:text-foreground">
                Book a demo
              </a>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-bold">Account</span>
              <Link href="/login" className="text-ink-3 hover:text-foreground">
                Log in
              </Link>
              <Link href="/signup" className="text-ink-3 hover:text-foreground">
                Start free trial
              </Link>
            </div>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl text-xs text-muted-foreground">© {new Date().getFullYear()} GoInstall. All rights reserved.</p>
      </footer>
    </div>
  );
}
