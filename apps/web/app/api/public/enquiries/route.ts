import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createEnquiry } from "@/lib/enquiries";

/**
 * Public endpoint for website enquiry forms. Identifies the company by its
 * enquiry form key, then creates (or reuses, by email) a contact and adds a
 * new enquiry project. Accepts JSON or a normal HTML form post; a form post
 * with a `redirect` field is sent back to that URL.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const schema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  email: z
    .union([z.literal(""), z.email().max(320)])
    .optional()
    .transform((v) => v?.toLowerCase() || null),
  phone: text(40),
  address: text(300),
  town: text(100),
  postcode: text(10).transform((v) => v?.toUpperCase() ?? null),
  products: z
    .array(z.enum(["solar", "battery", "ev"]))
    .max(3)
    .default([]),
  message: text(5000),
  source: text(100),
  redirect: z.url().optional(),
  // Honeypot: real visitors never fill this hidden field.
  _hp: z.string().optional(),
});

async function readBody(
  request: NextRequest,
): Promise<{ data: Record<string, unknown>; isForm: boolean }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    const products = json.products;
    return {
      data: {
        ...json,
        products: Array.isArray(products)
          ? products
          : products
            ? [products]
            : [],
      },
      isForm: false,
    };
  }
  const form = await request.formData();
  const data: Record<string, unknown> = {};
  for (const [k, v] of form.entries())
    if (typeof v === "string" && k !== "products") data[k] = v;
  data.products = form.getAll("products").map(String);
  return { data, isForm: true };
}

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  let body: Awaited<ReturnType<typeof readBody>>;
  try {
    body = await readBody(request);
  } catch {
    return reply(400, { error: "Could not read the form." });
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success)
    return reply(422, {
      error: "Name and form key are required.",
      issues: parsed.error.issues.map((i) => i.path.join(".")),
    });
  const e = parsed.data;
  if (!e.email && !e.phone)
    return reply(422, { error: "Give an email address or phone number." });

  // Only redirect back to the site that posted the form, so this route can't
  // be used as an open redirect.
  const origin =
    request.headers.get("origin") ?? request.headers.get("referer");
  const safeRedirect =
    e.redirect && origin && new URL(e.redirect).host === new URL(origin).host
      ? e.redirect
      : null;
  const done = () =>
    body.isForm && safeRedirect
      ? NextResponse.redirect(safeRedirect, { status: 303, headers: CORS })
      : reply(201, { ok: true });

  if (e._hp) return done(); // pretend success to bots

  const created = await createEnquiry(e);

  if (!created) return reply(404, { error: "Unknown form key." });
  return done();
}
