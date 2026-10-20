import { describe, expect, it } from "vitest";
import { checkEnquiry, DEFAULT_ENQUIRY_FORM, embedSnippet, enquiryFormConfig } from "./enquiry-form";

const answers = { name: "Sam", email: "sam@example.com", phone: "07700 900000", postcode: "BS1 4DJ", address: "", message: "", products: ["solar"] };

describe("enquiry form", () => {
  it("fills gaps and ignores bad stored values", () => {
    expect(enquiryFormConfig(null)).toEqual(DEFAULT_ENQUIRY_FORM);
    const c = enquiryFormConfig({ heading: "  ", fields: { phone: "hidden", postcode: "nonsense" }, products: ["ev", "boiler"] });
    expect(c.heading).toBe(DEFAULT_ENQUIRY_FORM.heading);
    expect(c.fields.phone).toBe("hidden");
    expect(c.fields.postcode).toBe("required");
    expect(c.products).toEqual(["ev"]);
  });

  it("checks required fields and offered products", () => {
    expect(checkEnquiry(DEFAULT_ENQUIRY_FORM, answers)).toEqual({ ok: true, products: ["solar"] });
    const bad = checkEnquiry(DEFAULT_ENQUIRY_FORM, { ...answers, email: "nope", phone: " ", products: ["boiler"] });
    expect(bad).toEqual({ ok: false, errors: { email: "Enter a valid email address", phone: "Enter your phone", products: "Choose what you're interested in" } });
    const evOnly = enquiryFormConfig({ products: [] });
    expect(checkEnquiry(evOnly, { ...answers, products: [] })).toEqual({ ok: true, products: [] });
  });

  it("makes the embed snippet", () => {
    expect(embedSnippet("https://app.example/", "abc")).toBe('<div data-goinstall-form="abc"></div>\n<script src="https://app.example/embed/enquiry.js" async></script>');
  });
});
