// Trade Check server: serves the page and runs checks on your Anthropic API key.
// Run: ANTHROPIC_API_KEY=sk-ant-... npm start   (then open http://localhost:8787)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.TRADE_CHECK_MODEL || "claude-opus-5-5";
const CHECKS_PER_HOUR = Number(process.env.CHECKS_PER_HOUR || 10); // per visitor IP, protects your credits
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_PAUSE_CONTINUATIONS = 3;

const client = new Anthropic();

const SYSTEM = `You are Trade Check, a careful assistant that helps Pokemon TCG collectors judge whether a listing, a seller conversation, or a proposed trade is safe and fairly priced.

You receive any of: listing text, a pasted chat with a seller or trader, the asking price, and up to four photos (card photos, listing screenshots, chat screenshots).

Do this:
1. Identify every card you can (name, set, card number, and grade/slab if shown).
2. Use web search to find current market prices for each card (recent sold listings on TCGplayer, eBay sold, PriceCharting or similar). Prefer sold prices over asking prices. Note the source site.
3. Look for scam patterns: moving the deal off-platform (WhatsApp, Telegram, DMs), payment methods without buyer protection (bank transfer, PayNow, Zelle, Friends & Family, crypto, gift cards), urgency or pressure, prices far below market, stock photos or photos without a timestamp/username, refusing video calls or extra photos, new or empty seller profiles, preorders for sold-out products.
4. Look for counterfeit signs visible in photos: wrong font or HP font, missing accent on "Pokémon", off card-back colors or border widths, blurry or misaligned print, wrong or fuzzy set symbol, wrong holo pattern, wrong card size, typos, or a slab label whose layout looks off. Only judge what the photos actually show; say "unclear" when they can't show it.
5. Decide a verdict: "safe" (no meaningful red flags), "caution" (some red flags or not enough info), or "scam" (strong scam or counterfeit signals). Give a risk score from 0 (no risk) to 100 (almost certainly a scam).

You can't authenticate a physical card from photos. Never say a card is definitely real.

Reply with ONLY one JSON object, no prose before or after, in this shape:
{
  "verdict": "safe" | "caution" | "scam",
  "risk": 0-100,
  "headline": "one short sentence, max 12 words",
  "summary": "2-3 plain sentences for a collector",
  "cards": [{"name": "", "set": "", "number": "", "grade": "", "asking_price": "", "market_low": number|null, "market_high": number|null, "currency": "USD", "price_source": "site name"}],
  "price_check": "one sentence comparing asking price to market, or empty",
  "red_flags": [{"severity": "high" | "medium" | "low", "flag": "short label", "why": "one sentence"}],
  "good_signs": ["short phrase"],
  "fake_checks": [{"check": "short label", "result": "pass" | "fail" | "unclear", "note": "one sentence"}],
  "next_steps": ["short imperative sentence"]
}`;

// --- tiny per-IP rate limit -------------------------------------------------
const hits = new Map();
function allow(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= CHECKS_PER_HOUR) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Photos are too large. Use smaller images."), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

// Parses "data:image/jpeg;base64,..." into an image content block.
function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const unreadable = () => Object.assign(new Error("Claude's answer couldn't be read. Try again."), { status: 422 });
  if (start < 0 || end <= start) throw unreadable();
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw unreadable();
  }
}

async function runCheck({ text, askingPrice, images }) {
  const content = [];
  for (const img of (images || []).slice(0, MAX_IMAGES)) {
    const block = imageBlock(img);
    if (block) content.push(block);
  }
  const parts = [];
  if (text?.trim()) parts.push(`Listing or chat:\n"""\n${text.trim().slice(0, 8000)}\n"""`);
  if (askingPrice?.trim()) parts.push(`Asking price: ${askingPrice.trim().slice(0, 100)}`);
  if (content.length) parts.push(`${content.length} photo(s) attached above.`);
  if (!parts.length) throw Object.assign(new Error("Add listing text, a chat, or a photo first."), { status: 400 });
  content.push({ type: "text", text: parts.join("\n\n") + "\n\nCheck this deal." });

  const messages = [{ role: "user", content }];
  let response;
  for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    });
    response = await stream.finalMessage();
    if (response.stop_reason !== "pause_turn") break;
    // Server-side search loop paused: send the partial turn back and it resumes.
    messages.splice(1, messages.length - 1, { role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") {
    throw Object.assign(new Error("This one couldn't be checked. Try different text or photos."), { status: 422 });
  }
  const finalText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const result = extractJson(finalText);
  result.mode = "live";
  return result;
}

// index.html is written as a page body (it also publishes as a Claude artifact), so wrap it here.
const indexHtml = () =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' +
  fs.readFileSync(path.join(here, "index.html"), "utf8") +
  "</body></html>";

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      const html = indexHtml();
      if (!/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return send(res, 200, html, "text/html; charset=utf-8");
      // The page is about 170 KB of HTML; gzip makes it about 50 KB on phones.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-encoding": "gzip", vary: "accept-encoding" });
      return res.end(zlib.gzipSync(html));
    }
    if (req.method === "POST" && req.url === "/api/check") {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (!allow(ip)) return send(res, 429, { error: "You've hit the hourly limit. Try again later." });
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        throw Object.assign(new Error(e.status ? e.message : "The request couldn't be read."), { status: e.status || 400 });
      }
      const result = await runCheck(body);
      return send(res, 200, result);
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    let status = err.status && err.status < 500 ? err.status : 502;
    let message = err.status && err.status < 500 && !(err instanceof Anthropic.APIError) ? err.message : "The check failed. Try again.";
    if (err instanceof Anthropic.AuthenticationError) message = "The server's API key is missing or invalid.";
    else if (err instanceof Anthropic.RateLimitError) { status = 429; message = "Too many checks right now. Try again in a minute."; }
    else if (err instanceof Anthropic.APIError) status = 502;
    console.error(err);
    send(res, status, { error: message });
  }
});

server.listen(PORT, () => console.log(`Trade Check running on http://localhost:${PORT} (model ${MODEL})`));
