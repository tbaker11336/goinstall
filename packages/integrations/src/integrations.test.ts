import { describe, expect, it, vi } from "vitest";
import { createMemoryFileStore, createResendSender, createSupabaseFileStore, textToHtml } from "./index";

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
