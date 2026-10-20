import { groupBySection } from "@goinstall/core";
import { withService } from "@goinstall/db";
import type { Metadata } from "next";
import { Logo } from "@/components/sidebar";
import { db } from "@/lib/db";
import { signedUrls } from "@/lib/files";
import { findPublicSurvey, surveyConfig, surveyPhotos, touchSurvey } from "@/lib/survey";
import { SurveyForm } from "./survey-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your online survey",
  // Survey links are private: keep them out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicSurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await withService(db(), async (tx) => {
    const survey = await findPublicSurvey(tx, token);
    if (!survey) return null;
    await touchSurvey(tx, survey);
    const [{ questions, categories }, photos] = await Promise.all([
      surveyConfig(tx, survey.products, { online: true, companyId: survey.companyId }),
      surveyPhotos(tx, survey.projectId, survey.companyId),
    ]);
    return { survey, questions, categories, photos };
  });

  if (!data) {
    return (
      <Shell>
        <section className="rounded-2xl border bg-card px-6 py-10 text-center">
          <h1 className="text-xl font-bold">This link isn&apos;t working</h1>
          <p className="mt-2 text-ink-3">It may have expired or been replaced by a newer link. Please ask the installer who sent it for a new one.</p>
        </section>
      </Shell>
    );
  }

  const { survey, questions, categories, photos } = data;
  const urls = await signedUrls(photos.map((p) => p.path), 1800);
  const values = Object.fromEntries(survey.fields.map((f) => [f.key, f.value]));
  const accent = survey.company.brandColour;

  return (
    <Shell companyName={survey.company.name} accent={accent}>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Your online survey</h1>
        <p className="text-ink-3">
          Hi {survey.customerName}. A few questions about {survey.siteAddress ?? "your home"} so {survey.company.name} can design your system. It takes about 10
          minutes.
        </p>
      </header>
      <SurveyForm
        token={token}
        sections={groupBySection(questions).map((g) => ({
          section: g.section,
          questions: g.questions.map((q) => ({ key: q.key, label: q.label, help: q.help, type: q.type, options: q.options, required: q.required })),
        }))}
        categories={categories.map((c) => ({
          key: c.key,
          label: c.label,
          help: c.help,
          required: c.required,
          photos: photos.filter((p) => p.category === c.key).map((p) => ({ id: p.id, url: urls.get(p.path) ?? null, mine: p.source === "online_survey" })),
        }))}
        values={values}
        completed={survey.status === "completed"}
      />
      {(survey.company.phone || survey.company.email) && (
        <p className="text-center text-sm text-ink-3">
          Questions? Contact {survey.company.name}
          {survey.company.phone && (
            <>
              {" "}
              on{" "}
              <a href={`tel:${survey.company.phone}`} className="font-semibold text-primary">
                {survey.company.phone}
              </a>
            </>
          )}
          {survey.company.email && (
            <>
              {" "}
              or{" "}
              <a href={`mailto:${survey.company.email}`} className="font-semibold text-primary">
                {survey.company.email}
              </a>
            </>
          )}
          .
        </p>
      )}
    </Shell>
  );
}

function Shell({ children, companyName, accent }: { children: React.ReactNode; companyName?: string; accent?: string | null }) {
  // A company's brand colour replaces the GoInstall teal for buttons and highlights.
  const style = accent ? ({ "--primary": accent, "--primary-hover": accent, "--ring": accent } as React.CSSProperties) : undefined;
  return (
    <div style={style} className="min-h-dvh bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-xl items-center gap-2.5 px-4 py-3.5">
          <Logo size={28} />
          <span className="font-bold">{companyName ?? "GoInstall"}</span>
        </div>
      </div>
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12">{children}</main>
    </div>
  );
}
