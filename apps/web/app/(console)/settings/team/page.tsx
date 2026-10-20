import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { createTeamAction, deleteTeamAction, inviteUserAction, updateMemberAction } from "@/lib/actions/settings";
import { asUser } from "@/lib/auth";

export const metadata = { title: "Team & permissions" };

const ROLES = [
  { value: "admin", label: "Admin", help: "Everything, including settings, users and pricing" },
  { value: "office", label: "Office", help: "Contacts, projects, proposals, scheduling; no settings" },
  { value: "installer", label: "Installer", help: "Installer app: assigned jobs only" },
  { value: "subcontractor", label: "Subcontractor", help: "Installer app: assigned bookings only, no prices" },
];

export default async function TeamSettingsPage() {
  const { members, teams, me } = await asUser(
    async (tx, s) => {
      const [members, teams] = await Promise.all([
        tx.selectFrom("users").select(["id", "full_name", "email", "role", "team_id", "is_active"]).orderBy("is_active", "desc").orderBy("full_name").execute(),
        tx.selectFrom("teams").select(["id", "name", "colour"]).orderBy("name").execute(),
      ]);
      return { members, teams, me: s.userId };
    },
    ["admin"],
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="px-4 py-2 font-medium">Role, team and status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-3">
                    <span className="block font-medium">
                      {m.full_name}
                      {m.id === me && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{m.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ActionForm action={updateMemberAction.bind(null, m.id)} className="flex flex-wrap items-center gap-2">
                      <Select name="role" defaultValue={m.role} aria-label={`Role for ${m.full_name}`} className="w-40">
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                      <Select name="team_id" defaultValue={m.team_id ?? ""} aria-label={`Team for ${m.full_name}`} className="w-44">
                        <option value="">No team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                      <Select name="is_active" defaultValue={String(m.is_active)} aria-label={`Status for ${m.full_name}`} className="w-32">
                        <option value="true">Active</option>
                        <option value="false">Deactivated</option>
                      </Select>
                      <SubmitButton size="sm" variant="outline">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={inviteUserAction} className="grid gap-4" resetOnSuccess>
              <Field label="Name" htmlFor="invite-name">
                <Input id="invite-name" name="full_name" required />
              </Field>
              <Field label="Email" htmlFor="invite-email">
                <Input id="invite-email" name="email" type="email" required />
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Role</legend>
                <div className="grid gap-2">
                  {ROLES.map((r, i) => (
                    <label key={r.value} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="role" value={r.value} defaultChecked={i === 1} className="mt-0.5 size-4 accent-primary" />
                      <span>
                        <span className="font-medium">{r.label}</span>
                        <span className="block text-xs text-muted-foreground">{r.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Team" htmlFor="invite-team">
                <Select id="invite-team" name="team_id" defaultValue="">
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Install teams</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {teams.length ? (
              <ul className="grid gap-2">
                {teams.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="size-3 rounded-full" style={{ background: t.colour ?? "#94a3b8" }} aria-hidden />
                      {t.name}
                      <span className="text-xs text-muted-foreground">{members.filter((m) => m.team_id === t.id).length} people</span>
                    </span>
                    <form action={deleteTeamAction.bind(null, t.id)}>
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Delete team ${t.name}`}>
                        Delete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No teams yet. Teams are assigned to install bookings.</p>
            )}
            <ActionForm action={createTeamAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <Field label="New team" htmlFor="team-name" className="flex-1">
                <Input id="team-name" name="name" required placeholder="e.g. Install team B" />
              </Field>
              <Field label="Colour" htmlFor="team-colour">
                <Input id="team-colour" name="colour" type="color" defaultValue="#2563EB" className="w-16 p-1" />
              </Field>
              <SubmitButton variant="outline">Add team</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
