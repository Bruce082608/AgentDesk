import { describe, expect, it } from "vitest";
import { __test__ } from "./web-search.js";

describe("web search parsing", () => {
  it("parses DuckDuckGo result URLs and snippets", () => {
    const html = `
      <div class="result results_links result__body">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpost%3Futm_source%3Dddg">Example &amp; Result</a>
        <a class="result__snippet">A <b>useful</b> snippet &amp; context.</a>
        <a class="result__url">example.com/post</a>
      </div>
    `;

    expect(__test__.parseDuckDuckGoResults(html, 5)).toEqual([{
      title: "Example & Result",
      url: "https://example.com/post?utm_source=ddg",
      displayUrl: "example.com/post",
      snippet: "A useful snippet & context.",
      sourceEngine: "duckduckgo-html"
    }]);
  });

  it("parses Bing result blocks", () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.org/report">Report title</a></h2>
        <div><p>Fresh result snippet.</p></div>
      </li>
    `;

    expect(__test__.parseBingResults(html, 5)).toEqual([{
      title: "Report title",
      url: "https://example.org/report",
      displayUrl: "example.org",
      snippet: "Fresh result snippet.",
      sourceEngine: "bing-html"
    }]);
  });

  it("deduplicates tracking variants by canonical URL", () => {
    expect(__test__.canonicalUrlKey("https://example.com/a/?utm_source=x#section")).toBe("https://example.com/a");
  });

  it("extracts readable article text without script and navigation noise", () => {
    const html = `
      <html>
        <head><script>ignore()</script><style>.x{}</style></head>
        <body>
          <nav>Menu text</nav>
          <article><h1>Title</h1><p>Main article &amp; details.</p></article>
        </body>
      </html>
    `;

    expect(__test__.extractReadableText(html)).toBe("Title Main article & details.");
  });
});
