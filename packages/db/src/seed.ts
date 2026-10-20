import type pg from "pg";

/**
 * Demo data for local development and end-to-end tests: one installer
 * company with a user per role and contacts at every stage, plus a second
 * company to show tenant isolation. Uses the auth.users stand-in, so it is
 * for local databases only.
 */

interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "office" | "installer" | "subcontractor";
}

export const DEMO_COMPANY_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_COMPANY_ID = "00000000-0000-4000-8000-000000000002";

export const DEMO_USERS: SeedUser[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Alex Morgan", email: "alex@brightside.test", role: "admin" },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "Priya Shah", email: "priya@brightside.test", role: "office" },
  { id: "00000000-0000-4000-8000-0000000000a3", name: "Dan Hughes", email: "dan@brightside.test", role: "installer" },
  { id: "00000000-0000-4000-8000-0000000000a4", name: "Lee Carter", email: "lee@scaffold.test", role: "subcontractor" },
];

export const OTHER_USERS: SeedUser[] = [
  { id: "00000000-0000-4000-8000-0000000000b1", name: "Sam Wright", email: "sam@northern.test", role: "admin" },
];

interface SeedContact {
  name: string;
  email: string;
  phone: string;
  address: [line1: string, town: string, postcode: string];
  source: string;
  products: ("solar" | "battery" | "ev")[];
  projectStage?: string;
  lostReason?: string;
  value?: number;
  note?: string;
}

const CONTACTS: SeedContact[] = [
  {
    name: "Helen Price",
    email: "helen.price@example.com",
    phone: "+447700900101",
    address: ["14 Cotham Road", "Bristol", "BS6 6DR"],
    source: "Website",
    products: ["solar", "battery"],
    projectStage: "enquiry",
    note: "Wants to understand battery payback before booking a survey.",
  },
  {
    name: "Tom Aldridge",
    email: "tom.aldridge@example.com",
    phone: "+447700900102",
    address: ["3 Mill Lane", "Keynsham", "BS31 1AA"],
    source: "Referral",
    products: ["ev"],
    projectStage: "survey",
    value: 1150,
  },
  {
    name: "Grace Okafor",
    email: "grace.okafor@example.com",
    phone: "+447700900103",
    address: ["27 Henleaze Gardens", "Bristol", "BS9 4HJ"],
    source: "Google Ads",
    products: ["solar", "ev"],
    projectStage: "design",
    value: 9800,
  },
  {
    name: "Martin & Jo Fielding",
    email: "fieldings@example.com",
    phone: "+447700900104",
    address: ["The Old Barn, Church Street", "Wrington", "BS40 5LG"],
    source: "Website",
    products: ["solar", "battery", "ev"],
    projectStage: "proposal_sent",
    value: 16450,
  },
  {
    name: "Rachel Bennett",
    email: "rachel.bennett@example.com",
    phone: "+447700900105",
    address: ["8 Elm Close", "Portishead", "BS20 6RT"],
    source: "Facebook",
    products: ["solar"],
    projectStage: "deposit_paid",
    value: 7200,
  },
  {
    name: "Owen Lewis",
    email: "owen.lewis@example.com",
    phone: "+447700900106",
    address: ["52 Gloucester Road", "Bristol", "BS7 8BH"],
    source: "Referral",
    products: ["ev"],
    projectStage: "scheduled",
    value: 1050,
  },
  {
    name: "Sophie Turner",
    email: "sophie.t@example.com",
    phone: "+447700900107",
    address: ["19 Station Road", "Nailsea", "BS48 4PD"],
    source: "Website",
    products: ["solar", "battery"],
    projectStage: "lost",
    lostReason: "Went with a cheaper quote",
    value: 11200,
  },
  {
    name: "David Chen",
    email: "david.chen@example.com",
    phone: "+447700900108",
    address: ["6 Park Row", "Clevedon", "BS21 7QS"],
    source: "Show / event",
    products: ["battery"],
  },
];

export async function seed(client: pg.Client): Promise<void> {
  await client.query("begin");
  try {
    await client.query(
      `insert into companies (id, name, website, phone, email, address_line1, town, postcode,
         company_number, vat_number, mcs_number, brand_primary_colour, document_prefix, default_deposit_pct)
       values ($1, 'Brightside Solar & EV Ltd', 'https://brightside.test', '0117 496 0000', 'hello@brightside.test',
         'Unit 4, Avon Trade Park', 'Bristol', 'BS2 0QA', '12345678', 'GB123456789', 'NAP-12345', '#0F766E', 'BSE', 25),
         ($2, 'Northern Renewables', null, null, null, null, 'Leeds', 'LS1 4AP', null, null, null, null, 'NR', 30)`,
      [DEMO_COMPANY_ID, OTHER_COMPANY_ID],
    );

    const {
      rows: [team],
    } = await client.query("insert into teams (company_id, name, colour) values ($1, 'Install team A', '#2563EB') returning id", [
      DEMO_COMPANY_ID,
    ]);

    for (const [companyId, users] of [
      [DEMO_COMPANY_ID, DEMO_USERS],
      [OTHER_COMPANY_ID, OTHER_USERS],
    ] as const) {
      for (const u of users) {
        await client.query("insert into auth.users (id, email) values ($1, $2)", [u.id, u.email]);
        await client.query(
          "insert into users (id, company_id, full_name, email, role, team_id) values ($1, $2, $3, $4, $5, $6)",
          [u.id, companyId, u.name, u.email, u.role, u.role === "installer" ? team.id : null],
        );
      }
    }

    const owner = DEMO_USERS[1]!.id;
    for (const [i, c] of CONTACTS.entries()) {
      const {
        rows: [contact],
      } = await client.query(
        `insert into contacts (company_id, name, email, phone, address_line1, town, postcode, source, interested_in, owner_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(days => $11)) returning id`,
        [DEMO_COMPANY_ID, c.name, c.email, c.phone, ...c.address, c.source, c.products, owner, (CONTACTS.length - i) * 3],
      );
      if (c.projectStage) {
        await client.query(
          `insert into projects (company_id, contact_id, site_address_line1, site_town, site_postcode, products, stage,
             lost_reason, value, owner_id, target_install_month)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, date_trunc('month', now() + interval '2 months')::date)`,
          [DEMO_COMPANY_ID, contact.id, ...c.address, c.products, c.projectStage, c.lostReason ?? null, c.value ?? null, owner],
        );
      }
      if (c.note) {
        await client.query(
          "insert into messages (company_id, contact_id, channel, direction, body, sent_by) values ($1, $2, 'note', 'internal', $3, $4)",
          [DEMO_COMPANY_ID, contact.id, c.note, owner],
        );
      }
    }

    // One contact in the other company, to show isolation.
    const {
      rows: [other],
    } = await client.query(
      "insert into contacts (company_id, name, email, town, postcode, source, interested_in) values ($1, 'Isla Moore', 'isla@example.com', 'Leeds', 'LS6 2AB', 'Website', '{solar}') returning id",
      [OTHER_COMPANY_ID],
    );
    await client.query("insert into projects (company_id, contact_id, products, site_town, site_postcode) values ($1, $2, '{solar}', 'Leeds', 'LS6 2AB')", [
      OTHER_COMPANY_ID,
      other.id,
    ]);

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}
