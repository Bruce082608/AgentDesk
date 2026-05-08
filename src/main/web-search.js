import { normalizeLanguage, t } from "./i18n.js";

export async function webSearch(query, maxResults, language) {
  const searchQuery = String(query ?? "").trim();
  if (!searchQuery) throw localizedError(language, "tools.emptyQuery");
  const limit = Math.min(Math.max(Number(maxResults) || 5, 1), 10);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
  const { signal, cleanup } = createTimeoutSignal(20000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 AgentWindow/1.0",
        Accept: "text/html,application/xhtml+xml"
      },
      signal
    });
    if (!response.ok) {
      throw localizedError(language, "tools.searchFailed", { status: response.status, message: response.statusText });
    }
    const html = await response.text();
    const results = parseDuckDuckGoResults(html, limit);
    return JSON.stringify(
      {
        query: searchQuery,
        engine: "duckduckgo-html",
        results,
        note: "Search snippets may be incomplete. Open important URLs separately if precise source text is required."
      },
      null,
      2
    );
  } catch (error) {
    if (error?.name === "AbortError") throw localizedError(language, "tools.searchTimeout");
    throw error;
  } finally {
    cleanup();
  }
}

function parseDuckDuckGoResults(html, limit) {
  const results = [];
  const blocks = String(html).split(/<div class="result results_links[\s\S]*?result__body">/g).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    if (block.includes("result--ad")) continue;

    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const displayUrlMatch = block.match(/<a[^>]*class="result__url"[^>]*>([\s\S]*?)<\/a>/i);

    const targetUrl = normalizeSearchUrl(decodeHtml(titleMatch[1]));
    if (!targetUrl) continue;
    results.push({
      title: cleanHtmlText(titleMatch[2]),
      url: targetUrl,
      displayUrl: displayUrlMatch ? cleanHtmlText(displayUrlMatch[1]) : "",
      snippet: snippetMatch ? cleanHtmlText(snippetMatch[1]) : ""
    });
  }
  return results;
}

function normalizeSearchUrl(rawUrl) {
  let value = String(rawUrl || "").replaceAll("&amp;", "&").trim();
  if (value.startsWith("//duckduckgo.com/l/?")) value = `https:${value}`;
  if (value.startsWith("/l/?")) value = `https://duckduckgo.com${value}`;
  try {
    const parsed = new URL(value);
    const redirected = parsed.searchParams.get("uddg");
    if (redirected) return decodeURIComponent(redirected);
    return parsed.href;
  } catch {
    return "";
  }
}

function cleanHtmlText(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
}

function localizedError(language, key, values = {}) {
  const error = new Error(t(language, key, values));
  error.language = normalizeLanguage(language);
  return error;
}

export const __test__ = {
  cleanHtmlText,
  decodeHtml,
  normalizeSearchUrl,
  parseDuckDuckGoResults
};
