import { normalizeLanguage, t } from "./i18n.js";

const SEARCH_TIMEOUT_MS = 18_000;
const PAGE_FETCH_TIMEOUT_MS = 8_000;
const MAX_SEARCH_RESULTS = 10;
const DEFAULT_PAGE_FETCHES = 3;
const MAX_PAGE_FETCHES = 5;
const MAX_PAGE_EXCERPT_CHARS = 1800;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 AgentDesk/1.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"
};

export async function webSearch(query, maxResults, language, options = {}) {
  const searchQuery = String(query ?? "").trim();
  if (!searchQuery) throw localizedError(language, "tools.emptyQuery");
  const limit = Math.min(Math.max(Number(maxResults) || 5, 1), MAX_SEARCH_RESULTS);
  const fetchPages = options.fetchPages !== false;
  const maxFetchPages = fetchPages
    ? Math.min(Math.max(Number(options.maxFetchPages) || DEFAULT_PAGE_FETCHES, 0), MAX_PAGE_FETCHES, limit)
    : 0;

  const searchResponses = await Promise.allSettled([
    searchDuckDuckGo(searchQuery, limit, language),
    searchBing(searchQuery, limit, language)
  ]);
  const engineResults = searchResponses
    .map((result) => result.status === "fulfilled" ? result.value : null)
    .filter(Boolean);
  const results = dedupeResults(engineResults.flatMap((engine) => engine.results)).slice(0, limit);

  if (results.length === 0) {
    const failures = searchResponses
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || String(result.reason))
      .filter(Boolean);
    if (failures.length === searchResponses.length) {
      throw localizedError(language, "tools.searchFailed", { status: "all", message: failures.join(" | ") });
    }
  }

  const enrichedResults = await enrichSearchResults(results, maxFetchPages);

  return JSON.stringify(
    {
      query: searchQuery,
      engines: engineResults.map((engine) => engine.engine),
      fetchedPages: enrichedResults.filter((result) => result.page?.ok).length,
      results: enrichedResults,
      note: fetchPages
        ? "Top results include best-effort page excerpts for source checking. Cite URLs used in the final answer."
        : "Search snippets may be incomplete. Open important URLs separately if precise source text is required."
    },
    null,
    2
  );
}

async function searchDuckDuckGo(query, limit, language) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, SEARCH_TIMEOUT_MS, language);
  return {
    engine: "duckduckgo-html",
    results: parseDuckDuckGoResults(html, limit)
  };
}

async function searchBing(query, limit, language) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const html = await fetchText(url, SEARCH_TIMEOUT_MS, language);
  return {
    engine: "bing-html",
    results: parseBingResults(html, limit)
  };
}

async function fetchText(url, timeoutMs, language) {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal
    });
    if (!response.ok) {
      throw localizedError(language, "tools.searchFailed", { status: response.status, message: response.statusText });
    }
    return await response.text();
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
    if (!targetUrl || isSearchEngineUrl(targetUrl)) continue;
    results.push({
      title: cleanHtmlText(titleMatch[2]),
      url: targetUrl,
      displayUrl: displayUrlMatch ? cleanHtmlText(displayUrlMatch[1]) : hostFromUrl(targetUrl),
      snippet: snippetMatch ? cleanHtmlText(snippetMatch[1]) : "",
      sourceEngine: "duckduckgo-html"
    });
  }
  return results;
}

function parseBingResults(html, limit) {
  const results = [];
  const blocks = String(html).split(/<li class="b_algo"[\s\S]*?>/g).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const targetUrl = normalizeSearchUrl(decodeHtml(titleMatch[1]));
    if (!targetUrl || isSearchEngineUrl(targetUrl)) continue;
    results.push({
      title: cleanHtmlText(titleMatch[2]),
      url: targetUrl,
      displayUrl: hostFromUrl(targetUrl),
      snippet: snippetMatch ? cleanHtmlText(snippetMatch[1]) : "",
      sourceEngine: "bing-html"
    });
  }
  return results;
}

function dedupeResults(results) {
  const byUrl = new Map();
  for (const result of results) {
    const key = canonicalUrlKey(result.url);
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, result);
  }
  return [...byUrl.values()];
}

async function enrichSearchResults(results, maxFetchPages) {
  if (maxFetchPages <= 0) return results;
  const candidates = results.slice(0, maxFetchPages);
  const pageResults = await Promise.allSettled(candidates.map((result) => fetchPageSummary(result.url)));
  return results.map((result, index) => {
    if (index >= pageResults.length) return result;
    const pageResult = pageResults[index];
    if (pageResult.status === "fulfilled") return { ...result, page: pageResult.value };
    return {
      ...result,
      page: {
        ok: false,
        error: pageResult.reason?.message || String(pageResult.reason)
      }
    };
  });
}

async function fetchPageSummary(url) {
  const html = await fetchText(url, PAGE_FETCH_TIMEOUT_MS, "en");
  const title = extractFirstMeta(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ]);
  const description = extractFirstMeta(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["'][^>]*>/i
  ]);
  const publishedAt = extractFirstMeta(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']date["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i
  ]);
  const text = extractReadableText(html);
  return {
    ok: true,
    title,
    description,
    publishedAt,
    excerpt: text.slice(0, MAX_PAGE_EXCERPT_CHARS),
    chars: text.length,
    truncated: text.length > MAX_PAGE_EXCERPT_CHARS
  };
}

function extractFirstMeta(html, patterns) {
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return cleanHtmlText(match[1]);
  }
  return "";
}

function extractReadableText(html) {
  const withoutNoise = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const articleMatch = withoutNoise.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  const mainMatch = withoutNoise.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  return cleanHtmlText(articleMatch?.[1] || mainMatch?.[1] || withoutNoise);
}

function normalizeSearchUrl(rawUrl) {
  let value = String(rawUrl || "").replaceAll("&amp;", "&").trim();
  if (value.startsWith("//duckduckgo.com/l/?")) value = `https:${value}`;
  if (value.startsWith("/l/?")) value = `https://duckduckgo.com${value}`;
  try {
    const parsed = new URL(value);
    const redirected = parsed.searchParams.get("uddg") || parsed.searchParams.get("u");
    if (redirected) return decodeURIComponent(redirected);
    return parsed.href;
  } catch {
    return "";
  }
}

function canonicalUrlKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      parsed.searchParams.delete(param);
    }
    return parsed.href.replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSearchEngineUrl(url) {
  const host = hostFromUrl(url);
  return host.includes("bing.com") || host.includes("duckduckgo.com");
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
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
    .replace(/&nbsp;/g, " ")
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
  canonicalUrlKey,
  cleanHtmlText,
  decodeHtml,
  extractReadableText,
  normalizeSearchUrl,
  parseBingResults,
  parseDuckDuckGoResults
};
