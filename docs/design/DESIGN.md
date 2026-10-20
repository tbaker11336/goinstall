# GoInstall — design system and screen guide

Build the UI to match the screens in `png/` (what it should look like) and `html/` (exact markup, spacing and colours). Treat the HTML as a reference, not production code: rebuild it as React components with Tailwind and shadcn/ui, as set out in SPEC.md.

All names, addresses, prices and figures in the screens are demo data. Wire every value to real data.

## Look

The style is clean and trustworthy: white cards on a soft grey page, one teal-green accent for primary actions and the current item, and amber only for things that need attention. Status always has a text label, never colour alone.

## Colour tokens

| Token | Hex | Use |
| --- | --- | --- |
| `bg` | `#F5F6F8` | Page background |
| `surface` | `#FFFFFF` | Cards, header, sidebar |
| `surface-subtle` | `#F9FAFB` | Table headers, figure tiles |
| `border` | `#E4E7EC` | Card and section borders |
| `border-strong` | `#D0D5DD` | Inputs, secondary buttons |
| `divider` | `#EEF0F3` | Row dividers inside cards |
| `ink` | `#101828` | Primary text |
| `ink-2` | `#344054` | Button text, labels |
| `ink-3` | `#475467` | Secondary text |
| `ink-4` | `#667085` | Meta text, captions |
| `accent` | `#0B7A62` | Primary buttons, active nav, selected items |
| `accent-hover` | `#08654F` | Primary button hover |
| `accent-strong` | `#075C4A` | Text on accent tint |
| `accent-tint` | `#E6F4EF` | Active nav background, selected cells, highlights |
| `accent-deep` | `#0B4F41` | "Next step" banner |
| `warn-text` | `#93370D` | Text on warning tint |
| `warn` | `#DC6803` | Warning icons, cable route |
| `warn-tint` | `#FFFCF5` / `#FEF0C7` | Warning backgrounds / pills |
| `warn-border` | `#F5C67A` | Warning borders, missing items |
| `success` | `#17B26A` | Ticks, live dots |
| `success-text` | `#067647` | Text on success tint |
| `success-tint` | `#DCFAE6` | Success pills |
| `info-text` | `#1849A9` | Text on info tint |
| `info` | `#2E6BE6` | Survey stage dot |
| `info-tint` | `#EFF4FF` | Info notices, Survey pill |
| `violet-text` / `violet` / `violet-tint` | `#4A1FB8` / `#6941C6` / `#F4F3FF` | Design stage |

### Stage pills

Each pill is a small dot plus a label on a tint.

| Stage | Tint | Text | Dot |
| --- | --- | --- | --- |
| Enquiry | `#F2F4F7` | `#344054` | `#98A2B3` |
| Survey | `info-tint` | `info-text` | `info` |
| Design | `violet-tint` | `violet-text` | `violet` |
| Proposal sent | `#FEF0C7` | `warn-text` | `warn` |
| Deposit paid / Installing | `success-tint` | `success-text` | `success` |
| Scheduled | `accent-tint` | `accent-strong` | `accent` |
| Kit ordered / Paperwork | `#F2F4F7` | `#344054` | `ink-4` |
| Lost | `#F2F4F7` | `ink-3` | `#D0D5DD` |

## Type

- Font: **Plus Jakarta Sans** (Google Fonts), weights 400, 500, 600 and 700. Numbers use `font-variant-numeric: tabular-nums`.
- Scale: page title 24–26 px/700 (letter-spacing −0.02em) · card title 16–17 px/700 · body 14 px/400–500 · meta 12.5–13 px · key figure 20 px/700 · hero figure 28–32 px/700.
- Uppercase labels (section names in proposals and app lists): 12 px/700, letter-spacing 0.05em, `ink-4`.

## Shape and spacing

- Radius: cards 12 px (app 16 px) · buttons and inputs 8 px (app 10–14 px) · pills 99 px · tags 6 px.
- Spacing: an 8 px rhythm with 4 px steps. Card padding 18–24 px, page padding 24–32 px, gap between cards 20–24 px.
- Shadow: only on floating elements (selected Kanban card, map overlays, active app card): `0 1px 2px rgba(16,24,40,0.06)` up to `0 4px 12px rgba(16,24,40,0.12)`.
- Controls: buttons and inputs are 40 px tall in the console, and 44–54 px in the app for touch.

## Layout

- **Console, CRM screens** (dashboard, contacts, contact, settings): 248 px sidebar with logo, nav, Settings pinned bottom-left and the user card. Content is fluid.
- **Console, project screens**: 72 px icon rail plus a white project header (breadcrumb, address and stage pill, contact line, actions, tabs). A tab shows a green tick once its stage is done.
- **Design screens**: a large canvas card (toolbar plus map) on the left, with a 340–380 px side panel of cards on the right.
- **Installer app**: 390 × 844 design size. White header, scrolling content, and a fixed bottom action button or tab bar (Jobs, Messages, Van stock, Profile).
- Responsive: rows wrap with `flex-wrap`, wide tables scroll horizontally inside their card, and the sidebar stacks on narrow screens.

## Components to build

Button (primary, secondary, icon), Input, Select, Textarea, Switch, Segmented control, Tabs (underline), Stage pill, Product tag, Avatar (initials), Card, Stat tile, Data table, Kanban column and card, Message bubble (inbound, outbound, system event), Timeline step, Progress bar, Notice (warning, info), Supplier price cell (selectable), Week schedule grid, Checklist step (done, current, to do), Photo tile (taken, missing), Signature pad.

Icons: 20 px stroke icons at 1.75 stroke width. Lucide matches the drawn icons closely.

## Screens

| # | File | Screen |
| --- | --- | --- |
| 01 | `01-dashboard` | Dashboard: stat tiles, projects table, today, messages |
| 02 | `02-contacts` | Contacts Kanban; columns scroll sideways. List view uses the same data as a table |
| 03 | `03-contact` | Contact: details, projects, email and WhatsApp thread with composer |
| 04 | `04-settings` | Settings: company, invoices and quotes, integrations, products and suppliers |
| 05 | `05-project-overview` | Project overview: progress, next step, activity, customer, key details |
| 06 | `06-project-survey` | Survey: online and site visit, merged fields with sources, photos |
| 07 | `07-project-solar-design` | Solar design: roof canvas, equipment, results, G99 notice |
| 08 | `08-project-ev-design` | EV design: site plan with cable route, supply, cable checks, solar link |
| 09 | `09-project-proposal` | Proposal preview, status timeline, deposit |
| 10 | `10-project-kit-suppliers` | Kit list with supplier price comparison, orders, connections |
| 11 | `11-project-install-paperwork` | Week schedule, team assignment, readiness, paperwork |
| 12–16 | `12-app-…` to `16-app-…` | Installer app: my jobs, job, site survey, install checklist, sign-off |

Note: the PNGs were rendered with Inter as a stand-in because Google Fonts couldn't be reached from the build environment. The HTML loads Plus Jakarta Sans normally.
