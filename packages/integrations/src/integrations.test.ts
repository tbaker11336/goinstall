import { describe, expect, it, vi } from "vitest";
import { addressParts, createExpoPush, createTwilio, twilioSignature, verifyTwilioSignature, googleYearlyEstimateKwh, createResendDomains, createStripePayments, signStripePayload, verifyStripeWebhook, createGoogleMapsClient, createMemoryFileStore, createOfflineSupplier, createPvgisClient, metresPerPixel, parseBuildingInsights, toLocalMetres, createRecordingSender, pvgisAspect, createResendSender, createSupabaseFileStore, textToHtml } from "./index";

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
    expect(await store.get("a.png")).toEqual(new Uint8Array([137, 80]));
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

describe("PVGIS", () => {
  it("converts azimuth to PVGIS aspect", () => {
    expect([180, 90, 270, 135, 0].map(pvgisAspect)).toEqual([0, -90, 90, -45, -180]);
  });
  it("requests PVcalc and reads monthly and annual totals", async () => {
    let url = "";
    const fetchMock = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ outputs: { monthly: { fixed: [{ month: 2, E_m: 200.4 }, { month: 1, E_m: 100.6 }] }, totals: { fixed: { E_y: 7010.2 } } } }));
    }) as unknown as typeof fetch;
    const r = await createPvgisClient({ fetch: fetchMock }).pvcalc({ lat: 52.06, lon: -1.34, kWp: 8.01, pitch: 35, azimuth: 180, lossPct: 14 });
    expect(r).toEqual({ annualKwh: 7010, monthlyKwh: [101, 200] });
    expect(url).toContain("peakpower=8.01");
    expect(url).toContain("aspect=0");
    expect(url).toContain("angle=35");
  });
});

describe("Google Solar", () => {
  it("parses roof segments and the largest suggested layout", () => {
    const insights = parseBuildingInsights({
      imageryQuality: "HIGH",
      center: { latitude: 52.06, longitude: -1.34 },
      solarPotential: {
        maxArrayPanelsCount: 30,
        roofSegmentStats: [
          { pitchDegrees: 35.24, azimuthDegrees: 178.6, stats: { areaMeters2: 40.33, sunshineQuantiles: [800, 900, 1000, 1100, 1200] }, center: { latitude: 52.0601, longitude: -1.3401 }, boundingBox: { sw: { latitude: 52.06, longitude: -1.341 }, ne: { latitude: 52.0602, longitude: -1.3392 } } },
        ],
        solarPanelConfigs: [
          { panelsCount: 4, roofSegmentSummaries: [{ segmentIndex: 0, panelsCount: 4 }] },
          { panelsCount: 18, roofSegmentSummaries: [{ segmentIndex: 0, panelsCount: 18 }] },
        ],
      },
    });
    expect(insights).toMatchObject({ imageryQuality: "HIGH", maxPanels: 30, suggestedPanels: { 0: 18 } });
    expect(insights.segments[0]).toMatchObject({ pitch: 35.2, azimuth: 178.6, areaM2: 40.3, sunshineHours: 1000 });
  });

  it("reads imagery date, carbon factor and Google's yearly estimates", () => {
    const insights = parseBuildingInsights({
      imageryDate: { year: 2025, month: 6, day: 3 },
      solarPotential: {
        panelCapacityWatts: 400,
        carbonOffsetFactorKgPerMwh: 228.5,
        solarPanelConfigs: [
          { panelsCount: 10, yearlyEnergyDcKwh: 3800 },
          { panelsCount: 20, yearlyEnergyDcKwh: 7400 },
        ],
      },
    });
    expect(insights).toMatchObject({ imageryDate: "2025-06-03", carbonOffsetKgPerMwh: 228.5, panelCapacityWatts: 400 });
    // 19 × 445 W from the nearest layout (20 × 400 W → 7,400 kWh).
    expect(googleYearlyEstimateKwh(insights, 19, 445)).toBe(Math.round((7400 / (20 * 400)) * 19 * 445));
    expect(googleYearlyEstimateKwh({ configs: [], panelCapacityWatts: 400 }, 19, 445)).toBeNull();
  });

  it("suggests UK addresses and looks up the chosen one", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith(":autocomplete"))
        return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: "abc", text: { text: "18 Rotherfield Road, Bristol, UK" }, structuredFormat: { mainText: { text: "18 Rotherfield Road" }, secondaryText: { text: "Bristol, UK" } } } }, { queryPrediction: {} }] }));
      return new Response(
        JSON.stringify({
          location: { latitude: 51.47, longitude: -2.61 },
          formattedAddress: "18 Rotherfield Rd, Bristol BS1, UK",
          addressComponents: [
            { longText: "18", types: ["street_number"] },
            { longText: "Rotherfield Road", types: ["route"] },
            { longText: "Bristol", types: ["postal_town"] },
            { longText: "City of Bristol", types: ["administrative_area_level_2", "political"] },
            { longText: "bs1 6qf", types: ["postal_code"] },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const client = createGoogleMapsClient({ apiKey: "k", fetch: fetchImpl });
    expect(await client.autocomplete("18 rotherf", "tok")).toEqual([{ placeId: "abc", main: "18 Rotherfield Road", secondary: "Bristol, UK" }]);
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ input: "18 rotherf", sessionToken: "tok", includedRegionCodes: ["gb"] });
    expect((calls[0]!.init!.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k");
    expect(await client.placeLocation("abc", "tok")).toEqual({
      at: { lat: 51.47, lng: -2.61 },
      address: "18 Rotherfield Rd, Bristol BS1, UK",
      parts: { line1: "18 Rotherfield Road", line2: "", town: "Bristol", county: "City of Bristol", postcode: "BS1 6QF" },
    });
    // A named house with no number: the name is line 1.
    expect(addressParts([{ longText: "Rose Cottage", types: ["premise"] }, { longText: "Henley-on-Thames", types: ["postal_town"] }])).toMatchObject({ line1: "Rose Cottage", line2: "", town: "Henley-on-Thames" });
    expect(addressParts([{ longText: "Flat 2", types: ["subpremise"] }, { longText: "Mill House", types: ["premise"] }, { longText: "4", types: ["street_number"] }, { longText: "Mill Lane", types: ["route"] }])).toMatchObject({ line1: "4 Mill Lane", line2: "Flat 2, Mill House" });
    expect(calls[1]!.url).toBe("https://places.googleapis.com/v1/places/abc?sessionToken=tok");
    const refused = createGoogleMapsClient({ apiKey: "k", fetch: (async () => new Response(JSON.stringify({ error: { message: "Places API (New) has not been used in project" } }), { status: 403 })) as unknown as typeof fetch });
    await expect(refused.autocomplete("18", "t")).rejects.toThrow(/Places API: Places API \(New\) has not been used/);
  });

  it("treats 404 as no coverage", async () => {
    const client = createGoogleMapsClient({ apiKey: "k", fetch: (async () => new Response(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "x" } }), { status: 404 })) as unknown as typeof fetch });
    expect((await client.buildingInsights({ lat: 1, lng: 1 })).status).toBe("no_coverage");
  });

  it("converts lat/lng to local metres and map scale", () => {
    const p = toLocalMetres({ lat: 52, lng: -1 }, { lat: 52.0001, lng: -0.9999 });
    expect(p.x).toBeCloseTo(6.85, 1);
    expect(p.y).toBeCloseTo(-11.13, 1);
    expect(metresPerPixel(52, 20)).toBeCloseTo(0.0919, 3);
  });
});

describe("Stripe", () => {
  it("creates a Checkout session on the company's connected account", async () => {
    let req: { url: string; init: RequestInit } | null = null;
    const fetchMock = (async (url: string, init: RequestInit) => {
      req = { url, init };
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }));
    }) as unknown as typeof fetch;
    const stripe = createStripePayments({ secretKey: "sk_test", fetch: fetchMock });
    const s = await stripe.createCheckout({ amountPence: 371250, description: "Deposit Q-0142", successUrl: "https://x/ok", cancelUrl: "https://x/no", metadata: { invoice_id: "inv1" }, connectedAccountId: "acct_9", idempotencyKey: "inv1" });
    expect(s).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" });
    const headers = req!.init.headers as Record<string, string>;
    expect(headers["Stripe-Account"]).toBe("acct_9");
    expect(headers["Idempotency-Key"]).toBe("inv1");
    const body = new URLSearchParams(req!.init.body as string);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("371250");
    expect(body.get("metadata[invoice_id]")).toBe("inv1");
    expect(body.get("line_items[0][price_data][currency]")).toBe("gbp");
  });

  it("verifies webhook signatures and rejects tampering and replays", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const header = signStripePayload(payload, "whsec_x", 1_000_000);
    expect(verifyStripeWebhook(payload, header, "whsec_x", { now: 1_000_010 }).id).toBe("evt_1");
    expect(() => verifyStripeWebhook(payload.replace("cs_1", "cs_2"), header, "whsec_x", { now: 1_000_010 })).toThrow(/mismatch/);
    expect(() => verifyStripeWebhook(payload, header, "whsec_other", { now: 1_000_010 })).toThrow(/mismatch/);
    expect(() => verifyStripeWebhook(payload, header, "whsec_x", { now: 1_001_000 })).toThrow(/tolerance/);
    expect(() => verifyStripeWebhook(payload, null, "whsec_x")).toThrow();
  });
});

describe("Resend domains", () => {
  it("creates a domain in the EU region and maps its DNS records", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "d_1", name: "mail.example.co.uk", status: "not_started", records: [{ record: "DKIM", name: "resend._domainkey.mail", type: "TXT", value: "p=abc", ttl: "Auto", status: "not_started" }] }), { status: 201 });
    }) as unknown as typeof fetch;
    const d = await createResendDomains({ apiKey: "k", fetch: fake }).create("mail.example.co.uk");
    expect(calls[0]).toEqual({ url: "https://api.resend.com/domains", body: { name: "mail.example.co.uk", region: "eu-west-1" } });
    expect(d).toEqual({ id: "d_1", name: "mail.example.co.uk", status: "not_started", records: [{ purpose: "DKIM", type: "TXT", name: "resend._domainkey.mail", value: "p=abc", priority: undefined, ttl: "Auto", status: "not_started" }] });
  });

  it("surfaces provider errors", async () => {
    const fake = (async () => new Response(JSON.stringify({ message: "This API key is restricted to only send emails" }), { status: 401 })) as unknown as typeof fetch;
    await expect(createResendDomains({ apiKey: "k", fetch: fake }).get("d_1")).rejects.toThrow(/restricted to only send/);
  });
});

describe("Twilio", () => {
  it("sends from the company's subaccount and reports errors", async () => {
    const calls: [string, RequestInit][] = [];
    const ok = createTwilio({ accountSid: "ACmaster", authToken: "tok", fetch: (async (u: string, i: RequestInit) => (calls.push([u, i]), new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }))) as unknown as typeof fetch });
    expect(await ok.send({ accountSid: "ACsub", from: "+447700900001", to: "+447700900123", body: "Hi" })).toEqual({ ok: true, providerId: "SM1" });
    expect(calls[0]![0]).toBe("https://api.twilio.com/2010-04-01/Accounts/ACsub/Messages.json");
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ACmaster:tok").toString("base64")}`);
    expect(String(calls[0]![1].body)).toBe("To=%2B447700900123&From=%2B447700900001&Body=Hi");
    const bad = createTwilio({ accountSid: "A", authToken: "t", fetch: (async () => new Response(JSON.stringify({ message: "Unsubscribed recipient", code: 21610 }), { status: 400 })) as unknown as typeof fetch });
    expect(await bad.send({ accountSid: "A", from: "+44", to: "+44", body: "x" })).toEqual({ ok: false, error: "Twilio: Unsubscribed recipient (21610)", retryable: false });
  });

  it("verifies webhook signatures (Twilio's documented example)", () => {
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(verifyTwilioSignature("12345", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
    expect(verifyTwilioSignature("12345", url, { ...params, Digits: "9" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(verifyTwilioSignature("12345", url, params, null)).toBe(false);
  });
});

describe("Expo push", () => {
  it("sends in batches and reports phones that have gone away", async () => {
    const bodies: unknown[] = [];
    const push = createExpoPush({
      accessToken: "tok",
      fetch: (async (_: string, init: RequestInit) => {
        const sent = JSON.parse(String(init.body)) as unknown[];
        bodies.push({ count: sent.length, auth: (init.headers as Record<string, string>).Authorization });
        return new Response(JSON.stringify({ data: sent.map((_, i) => (i === 0 ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `t${i}` })) }));
      }) as unknown as typeof fetch,
    });
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: "Job booked", body: "Tue 3 Nov" }));
    const r = await push.send(msgs);
    expect(bodies).toEqual([{ count: 100, auth: "Bearer tok" }, { count: 50, auth: "Bearer tok" }]);
    expect(r.invalidTokens).toEqual(["ExponentPushToken[0]", "ExponentPushToken[100]"]);
    expect(r.sent).toBe(148);
  });
});
