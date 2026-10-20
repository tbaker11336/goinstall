import { describe, expect, it, vi } from "vitest";
import { createMemoryFileStore, createOfflineSupplier, createRecordingSender, createResendSender, createSupabaseFileStore, textToHtml } from "./index";

describe("textToHtml", () => {
  it("escapes HTML, keeps paragraphs and links URLs", () => {
    expect(textToHtml("Hi <b>Sam</b>,\nline two\n\nGo to https://x.test/s/abc.")).toContain(
      '<p>Hi &lt;b&gt;Sam&lt;/b&gt;,<br>line two</p><p>Go to <a href="https://x.test/s/abc">https://x.test/s/abc</a>.</p>',
    );
  });
});

describe("Resend sender", () => {
  it("posts the email and returns the provider id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "em_123" }), { status: 200 }));
    const sender = createResendSender({ apiKey: "re_test", fetch: fetchMock as unknown as typeof fetch });
    const result = await sender.send({ from: "A <a@x.test>", to: "b@y.test", subject: "Hello", text: "Body", idempotencyKey: "k1", tags: { kind: "survey link" } });
    expect(result).toEqual({ ok: true, providerId: "em_123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: ["b@y.test"], subject: "Hello", text: "Body", tags: [{ name: "kind", value: "survey_link" }] });
  });

  it("reports validation errors as not retryable and rate limits as retryable", async () => {
    const make = (status: number, body: object) =>
      createResendSender({ apiKey: "k", fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch });
    expect(await make(422, { message: "The domain is not verified" }).send({ from: "a@x", to: "b@y", subject: "s", text: "t" })).toEqual({
      ok: false,
      error: "The domain is not verified",
      retryable: false,
    });
    expect(await make(429, {}).send({ from: "a@x", to: "b@y", subject: "s", text: "t" })).toMatchObject({ ok: false, retryable: true });
  });
});

describe("file stores", () => {
  it("Supabase store uploads and signs with the service key", async () => {
    const calls: [string, RequestInit][] = [];
    const fetchMock = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.includes("/sign/") ? new Response(JSON.stringify({ signedURL: "/object/sign/b/p%20x.jpg?token=t" })) : new Response("{}");
    }) as unknown as typeof fetch;
    const store = createSupabaseFileStore({ url: "https://ref.supabase.co/", serviceKey: "sk", bucket: "b", fetch: fetchMock });
    await store.put("c/p x.jpg", new Uint8Array([1]), "image/jpeg");
    expect(await store.signedUrl("c/p x.jpg", 60)).toBe("https://ref.supabase.co/storage/v1/object/sign/b/p%20x.jpg?token=t");
    expect(calls[0]![0]).toBe("https://ref.supabase.co/storage/v1/object/b/c/p%20x.jpg");
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe("Bearer sk");
  });

  it("memory store refuses overwrites and serves data URLs", async () => {
    const store = createMemoryFileStore();
    await store.put("a.png", new Uint8Array([137, 80]), "image/png");
    await expect(store.put("a.png", new Uint8Array([1]), "image/png")).rejects.toThrow();
    expect(await store.signedUrl("a.png")).toBe("data:image/png;base64,iVA=");
  });
});

describe("offline supplier", () => {
  const po = {
    reference: "PO-0311",
    companyName: "Brightside",
    deliveryAddress: "14 Elm Close, Banbury",
    requiredBy: new Date("2026-11-02T12:00:00Z"),
    lines: [
      { supplierSku: "A-445", description: "445 W panel", quantity: 18, unitCostPence: 9600 },
      { supplierSku: null, description: "Rails", quantity: 1, unitCostPence: 34000 },
    ],
  };

  it("emails the purchase order to the supplier", async () => {
    const sender = createRecordingSender();
    const supplier = createOfflineSupplier({ connection: "email", lookup: async () => [], sender, from: "a@x.test", orderEmail: "orders@s.test" });
    expect(await supplier.placeOrder(po)).toMatchObject({ ok: true });
    expect(sender.sent[0]).toMatchObject({ to: "orders@s.test", subject: "Purchase order PO-0311 from Brightside" });
    expect(sender.sent[0]!.text).toContain("18 × 445 W panel [A-445] @ £96.00");
    expect(sender.sent[0]!.text).toContain("Total (ex VAT): £2068.00");
    expect(sender.sent[0]!.text).toContain("Required by: 2 November 2026");
  });

  it("refuses to order without an order email", async () => {
    const supplier = createOfflineSupplier({ connection: "price_file", lookup: async () => [], sender: createRecordingSender(), from: "a@x", orderEmail: null });
    expect(await supplier.placeOrder(po)).toMatchObject({ ok: false });
  });
});
