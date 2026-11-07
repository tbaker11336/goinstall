import { BOARD_FIELDS, circuitGroups, circuitWarnings, type TestValues } from "@goinstall/core";

/** A board's details and its schedule of circuits and test results, laid out like the certificate's continuation sheet. */
export function TestSchedule({ title, board, circuits }: { title: string; board: TestValues; circuits: TestValues[] }) {
  const groups = circuitGroups();
  const shown = BOARD_FIELDS.filter((f) => board[f.key]);
  return (
    <div className="flex flex-col gap-3">
      {shown.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {shown.map((f) => (
            <div key={f.key} className="flex justify-between gap-2 border-b py-1">
              <dt className="text-ink-3">{f.label}</dt>
              <dd className="font-medium">
                {board[f.key]}
                {f.unit ? ` ${f.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {circuits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No circuits recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-max min-w-full border-collapse text-xs">
            <caption className="sr-only">Circuits and test results, {title}</caption>
            <thead>
              <tr className="bg-surface-subtle">
                {groups.map((g) => (
                  <th key={g.group} colSpan={g.fields.length} scope="colgroup" className="border-r border-b px-2 py-1 text-left font-semibold whitespace-nowrap last:border-r-0">
                    {g.group}
                  </th>
                ))}
              </tr>
              <tr className="bg-surface-subtle">
                {groups.flatMap((g) => g.fields).map((f) => (
                  <th key={f.key} scope="col" title={f.label} className="border-r border-b px-2 py-1 text-left font-medium whitespace-nowrap text-ink-2 last:border-r-0">
                    {f.short}
                    {f.unit ? <span className="font-normal text-ink-3"> {f.unit}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {circuits.map((c, i) => {
                const warn = circuitWarnings(c);
                return (
                  <tr key={i} className={warn.some((w) => !w.startsWith("No test")) ? "bg-red-50" : undefined} title={warn.join("; ") || undefined}>
                    {groups
                      .flatMap((g) => g.fields)
                      .map((f) => (
                        <td key={f.key} className={`border-r border-b px-2 py-1 whitespace-nowrap last:border-r-0 ${f.key === "designation" ? "min-w-40" : ""}`}>
                          {c[f.key] ?? ""}
                        </td>
                      ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {circuits.some((c) => circuitWarnings(c).length) && (
        <ul className="flex flex-col gap-0.5 text-sm text-warning-text" aria-label={`Checks for ${title}`}>
          {circuits.flatMap((c, i) => circuitWarnings(c).map((w) => <li key={`${i}-${w}`}>Circuit {c.ref || i + 1}: {w}</li>))}
        </ul>
      )}
    </div>
  );
}
