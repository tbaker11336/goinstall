import { formatPence } from "@goinstall/core";
import { Check } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ProposalDocument } from "@/components/proposal-document";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { recordBankTransferAction } from "@/lib/actions/proposals";
import { asUser } from "@/lib/auth";
import { proposalContent, proposalView } from "@/lib/proposals";
import { cn, formatDateTime } from "@/lib/utils";
import {
  CopyLinkButton,
  CreateProposalButton,
  ProposalEditor,
  SendButton,
  VersionSelect,
  type EditorLine,
} from "./proposal-client";

export const metadata = { title: "Proposal" };

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  sent: "sent",
  viewed: "viewed",
  accepted: "accepted",
  declined: "declined",
  superseded: "replaced",
};

function Step({
  done,
  current,
  title,
  detail,
  warn,
}: {
  done: boolean;
  current?: boolean;
  title: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2",
          done
            ? "border-success bg-success text-white"
            : current
              ? "border-warning"
              : "border-border",
        )}
      >
        {done && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <div>
        <p className="font-semibold">
          {title}
          <span className="sr-only">
            {done ? " (done)" : current ? " (waiting)" : ""}
          </span>
        </p>
        <p
          className={cn(
            "text-[13px]",
            warn ? "text-warning-text" : "text-ink-3",
          )}
        >
          {detail}
        </p>
      </div>
    </li>
  );
}

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await asUser(async (tx) => {
    const project = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .select(["p.id", "c.name as contact_name"])
      .where("p.id", "=", id)
      .executeTakeFirst();
    if (!project) return null;
    const [versions, hasDesign, company] = await Promise.all([
      tx
        .selectFrom("proposals")
        .select(["id", "number", "version", "status"])
        .where("project_id", "=", id)
        .orderBy("number", "desc")
        .orderBy("version", "desc")
        .execute(),
      tx
        .selectFrom("solar_designs")
        .select("id")
        .where("project_id", "=", id)
        .where("is_active", "=", true)
        .union(
          tx
            .selectFrom("ev_designs")
            .select("id")
            .where("project_id", "=", id)
            .where("is_active", "=", true),
        )
        .executeTakeFirst(),
      tx
        .selectFrom("companies")
        .select(["stripe_account_id", "vat_rates", "bank_account_number"])
        .executeTakeFirstOrThrow(),
    ]);
    const selected = versions.find((x) => x.id === v) ?? versions[0];
    if (!selected)
      return {
        project,
        versions,
        hasDesign: Boolean(hasDesign),
        company,
        content: null,
        proposal: null,
        invoice: null,
      };
    const [content, proposal, invoice] = await Promise.all([
      proposalContent(tx, selected.id),
      tx
        .selectFrom("proposals")
        .select([
          "id",
          "status",
          "sent_at",
          "sent_channels",
          "view_count",
          "last_viewed_at",
          "accepted_at",
          "accepted_name",
          "last_reminder_at",
          "deposit_pence",
          "total_pence",
          "deposit_pct",
        ])
        .where("id", "=", selected.id)
        .executeTakeFirstOrThrow(),
      tx
        .selectFrom("invoices")
        .select(["id", "number", "status", "paid_at", "amount_pence"])
        .where("proposal_id", "=", selected.id)
        .where("kind", "=", "deposit")
        .where("status", "!=", "void")
        .executeTakeFirst(),
    ]);
    return {
      project,
      versions,
      hasDesign: Boolean(hasDesign),
      company,
      content,
      proposal,
      invoice,
    };
  });
  if (!data) notFound();
  const { project, versions, hasDesign, company, content, proposal, invoice } =
    data;

  if (!content || !proposal) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
        <p>
          {hasDesign
            ? "Build the proposal from the saved design, then check it and send it."
            : "Save a solar or EV design first: the proposal is built from it."}
        </p>
        {hasDesign && (
          <CreateProposalButton
            projectId={id}
            label="Create proposal from design"
          />
        )}
      </div>
    );
  }

  const view = proposalView(content);
  const isDraft = proposal.status === "draft";
  const live = ["sent", "viewed"].includes(proposal.status);
  const latest = versions[0]!;
  const first = project.contact_name.split(/\s+/)[0] ?? project.contact_name;
  const deposit = Number(proposal.deposit_pence);
  const total = Number(proposal.total_pence);
  const labourVat =
    (company.vat_rates as Record<string, number> | null)?.labour ?? null;
  const editorLines: EditorLine[] = content.lines.map((l) => ({
    key: l.id,
    section: l.section as EditorLine["section"],
    productId: l.product_id,
    description: l.description,
    quantity: String(Number(l.quantity)),
    unitPrice: (Number(l.unit_price_pence) / 100).toFixed(2),
    vatRate: String(Number(l.vat_rate)),
    origin: l.origin as EditorLine["origin"],
  }));
  const payBy =
    [
      company.stripe_account_id ? "Card (Stripe)" : null,
      company.bank_account_number ? "bank transfer" : null,
    ]
      .filter(Boolean)
      .join(" or ") || "Set up in Settings › Invoices & quotes";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-end gap-3">
        <VersionSelect
          versions={versions.map((x) => ({
            id: x.id,
            label: `Version ${x.version} · ${STATUS_LABEL[x.status]}`,
          }))}
          current={proposal.id}
        />
        <a
          href={`/api/proposals/${proposal.id}/pdf`}
          className={buttonVariants({ variant: "outline" })}
        >
          Download PDF
        </a>
        {/* One slot for send and reminder, so the "sent" message survives the switch. */}
        {(isDraft || (live && proposal.id === latest.id)) && <SendButton key={proposal.id} proposalId={proposal.id} kind={isDraft ? "send" : "reminder"} />}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {isDraft && (
            <ProposalEditor
              key={`${proposal.id}-${content.lines.length}-${total}`}
              proposalId={proposal.id}
              initial={{
                title: view.title,
                intro: view.intro ?? "",
                depositPct: String(view.depositPct),
                lines: editorLines,
              }}
              labourVat={labourVat}
            />
          )}
          <ProposalDocument p={view} />
        </div>

        <aside className="flex flex-col gap-6" aria-label="Proposal status">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ol className="flex flex-col gap-4">
                <Step
                  done={Boolean(proposal.sent_at)}
                  current={isDraft}
                  title={proposal.sent_at ? "Sent by email" : "Not sent yet"}
                  detail={
                    proposal.sent_at
                      ? `${formatDateTime(proposal.sent_at)}${proposal.last_reminder_at ? ` · reminder ${formatDateTime(proposal.last_reminder_at)}` : ""}`
                      : "Check the draft, then send it"
                  }
                />
                <Step
                  done={proposal.view_count > 0}
                  title={
                    proposal.view_count > 0
                      ? `Viewed ${proposal.view_count === 1 ? "once" : `${proposal.view_count} times`}`
                      : "Not viewed yet"
                  }
                  detail={
                    proposal.last_viewed_at
                      ? `Last opened ${formatDateTime(proposal.last_viewed_at)}`
                      : `${first} hasn't opened it`
                  }
                />
                <Step
                  done={Boolean(proposal.accepted_at)}
                  current={live}
                  warn={live}
                  title="Accept and sign"
                  detail={
                    proposal.accepted_at
                      ? `Signed by ${proposal.accepted_name} · ${formatDateTime(proposal.accepted_at)}`
                      : proposal.status === "superseded"
                        ? "Replaced by a newer version"
                        : proposal.status === "declined"
                          ? "Declined"
                          : `Waiting for ${first}`
                  }
                />
                <Step
                  done={invoice?.status === "paid"}
                  current={
                    proposal.status === "accepted" && invoice?.status !== "paid"
                  }
                  title="Deposit paid"
                  detail={
                    invoice?.paid_at
                      ? `${formatDateTime(invoice.paid_at)} · ${invoice.number}`
                      : "Kit order is drafted next"
                  }
                />
              </ol>
              <div className="grid grid-cols-2 gap-3">
                {proposal.sent_at && proposal.status !== "superseded" ? (
                  <CopyLinkButton proposalId={proposal.id} />
                ) : (
                  <span />
                )}
                {!isDraft &&
                  proposal.id === latest.id &&
                  proposal.status !== "accepted" && (
                    <CreateProposalButton
                      projectId={id}
                      label="Edit proposal"
                      variant="outline"
                    />
                  )}
                {isDraft && (
                  <CreateProposalButton
                    projectId={id}
                    label="Rebuild from design"
                    variant="outline"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deposit</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm">
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-ink-3">Amount</dt>
                  <dd className="font-semibold">
                    {formatPence(deposit)} · {Number(proposal.deposit_pct)}%
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-ink-3">Pay by</dt>
                  <dd className="text-right font-semibold">
                    {payBy.charAt(0).toUpperCase() + payBy.slice(1)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-ink-3">Balance</dt>
                  <dd className="font-semibold">
                    {formatPence(total - deposit)} on completion
                  </dd>
                </div>
              </dl>
              {proposal.status === "accepted" && invoice?.status !== "paid" && (
                <ActionForm
                  action={recordBankTransferAction.bind(null, proposal.id)}
                  className="mt-4 flex flex-col gap-3 border-t pt-4"
                >
                  <Field label="Bank transfer received (£)" htmlFor="bt-amount">
                    <Input
                      id="bt-amount"
                      name="amount"
                      inputMode="decimal"
                      defaultValue={(deposit / 100).toFixed(2)}
                      required
                    />
                  </Field>
                  <SubmitButton variant="outline" pendingText="Recording…">
                    Record bank transfer
                  </SubmitButton>
                </ActionForm>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
