import { describe, expect, it } from "vitest";
import { coverHeadline, defaultTemplate, normaliseTemplate, templateFileIds, visiblePages } from "./proposal-template";

const photo = "11111111-1111-4111-8111-111111111111";

describe("proposal template", () => {
  it("starts with a cover, the quote and About us; the other pages wait to be filled in", () => {
    const t = defaultTemplate();
    expect(t.cover.enabled).toBe(true);
    expect(t.pages.map((p) => [p.type, p.enabled])).toEqual([
      ["quote", true],
      ["about", true],
      ["reviews", false],
      ["featured_work", false],
      ["accreditations", false],
    ]);
  });

  it("cleans what's saved: keeps the order, always has the quote once, drops empty items and bad links", () => {
    const t = normaliseTemplate({
      cover: { enabled: true, headline: "  Your solar proposal, {first_name}  ", imageFileId: "not-a-file" },
      pages: [
        { id: "reviews", type: "reviews", enabled: true, link: "javascript:alert(1)", reviews: [{ name: "Jo", rating: 7, text: "Great job" }, { name: "", text: "" }] },
        { type: "quote", enabled: false },
        { type: "quote" },
        { type: "featured_work", work: [{ title: "Barn roof", photoFileId: photo }] },
        { type: "boiler" },
        { type: "text", title: "Our guarantee", intro: "Ten years on workmanship." },
      ],
    });
    expect(t.cover).toEqual({ enabled: true, headline: "Your solar proposal, {first_name}", subheading: null, imageFileId: null });
    expect(t.pages.map((p) => p.type)).toEqual(["reviews", "quote", "featured_work", "text"]);
    expect(t.pages[0]!.reviews).toEqual([{ name: "Jo", location: null, rating: null, text: "Great job" }]);
    expect(t.pages[0]!.link).toBeNull();
    // The quote can't be switched off.
    expect(t.pages[1]!.enabled).toBe(true);
    expect(templateFileIds(t)).toEqual([photo]);
    expect(normaliseTemplate({ pages: [{ type: "about" }] }).pages.map((p) => p.type)).toEqual(["quote", "about"]);
  });

  it("shows only pages that are on and have content, and fills in the headline", () => {
    const t = normaliseTemplate({ pages: [{ type: "quote" }, { type: "about" }, { type: "reviews", enabled: true }, { type: "text", intro: "Hello" }, { type: "accreditations", enabled: false, accreditations: [{ name: "MCS" }] }] });
    expect(visiblePages(t, { about: false }).map((p) => p.type)).toEqual(["quote", "text"]);
    expect(coverHeadline({ ...t, cover: { ...t.cover, headline: "Solar for {address}, {first_name}" } }, { firstName: "Grace", name: "Grace Okafor", address: "27 Henleaze Gardens", fallback: "x" })).toBe("Solar for 27 Henleaze Gardens, Grace");
    expect(coverHeadline(t, { firstName: "G", name: "G", address: null, fallback: "Solar for 27 Henleaze Gardens" })).toBe("Solar for 27 Henleaze Gardens");
  });
});
