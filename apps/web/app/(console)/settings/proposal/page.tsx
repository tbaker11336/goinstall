import { normaliseTemplate, templateFileIds } from "@goinstall/core";
import { asUser } from "@/lib/auth";
import { signedUrls } from "@/lib/files";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Proposal template" };

/** Settings › Proposal: the front cover and pages every proposal is built from. */
export default async function ProposalTemplatePage() {
  const { template, files } = await asUser(
    async (tx, s) => {
      const c = await tx.selectFrom("companies").select("proposal_template").where("id", "=", s.companyId).executeTakeFirstOrThrow();
      const template = normaliseTemplate(c.proposal_template);
      const ids = templateFileIds(template);
      return { template, files: ids.length ? await tx.selectFrom("files").select(["id", "path"]).where("id", "in", ids).execute() : [] };
    },
    ["admin"],
  );
  const signed = await signedUrls(files.map((f) => f.path), 3600);
  const urls = Object.fromEntries(files.flatMap((f) => (signed.get(f.path) ? [[f.id, signed.get(f.path)!]] : [])));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Proposal template</h2>
        <p className="text-sm text-ink-3">A front cover and pages like reviews, featured work and accreditations, around the quote. They appear on the proposal page and its PDF.</p>
      </div>
      <TemplateEditor initial={template} urls={urls} />
    </div>
  );
}
