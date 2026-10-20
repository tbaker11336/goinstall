import { env } from "@/lib/env";

/**
 * Embed script for a company's website:
 *   <div data-goinstall-form="KEY"></div>
 *   <script src="https://…/embed/enquiry.js" async></script>
 * Puts the hosted form in an iframe and keeps its height in step with it.
 */
export function GET() {
  const origin = env.siteUrl.replace(/\/$/, "");
  const js = `(function () {
  var origin = ${JSON.stringify(origin)};
  document.querySelectorAll("[data-goinstall-form]").forEach(function (el) {
    if (el.getAttribute("data-goinstall-ready")) return;
    var key = el.getAttribute("data-goinstall-form");
    if (!/^[a-f0-9]{32}$/.test(key || "")) return;
    el.setAttribute("data-goinstall-ready", "1");
    var f = document.createElement("iframe");
    f.src = origin + "/f/" + key + "?embed=1";
    f.title = "Enquiry form";
    f.loading = "lazy";
    f.style.cssText = "width:100%;border:0;min-height:560px;background:transparent";
    el.appendChild(f);
    window.addEventListener("message", function (e) {
      if (e.origin !== origin || !e.data || e.data.type !== "goinstall:height" || e.data.key !== key) return;
      f.style.height = Math.ceil(e.data.height) + "px";
      f.style.minHeight = "0";
    });
  });
})();`;
  return new Response(js, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
