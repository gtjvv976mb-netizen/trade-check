# Trade Check

Paste a Pokemon card listing, a seller chat, or up to 4 photos. Claude returns a scam-risk score (0-100), red flags, fake-card checks and a price comparison. The result can be saved as a shareable "slab label" image.

There are two ways to run it. Both use the same `index.html`.

| Version | Who pays | Prices |
| --- | --- | --- |
| Claude artifact (published link) | Each viewer's own Claude account | Claude's estimates |
| This server | Your Anthropic API credits | Live sold prices via web search |

## Run the server locally

Needs Node 20 or newer.

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# open http://localhost:8787
```

Settings (environment variables):

- `ANTHROPIC_API_KEY`: required. Get one at console.anthropic.com.
- `CHECKS_PER_HOUR`: checks allowed per visitor per hour. Default 10. This protects your credits once the link is public.
- `CHECKS_PER_HOUR_TOTAL`: checks allowed per hour for all visitors together. Default 200. A backstop in case someone gets around the per-visitor limit.
- `CHECKS_IN_FLIGHT`: checks that may run at the same time, for all visitors together. Default 3. Each running check holds its photos in memory, so keep this low on a small instance. Each visitor can run one check at a time.
- `TRUST_PROXY`: how the server tells visitors apart. By default it uses the address the last proxy added to `X-Forwarded-For`, or the connection address. Set `cloudflare` when Cloudflare is in front, so it uses `CF-Connecting-IP`. On Render this is the default; set `none` there to turn it off. IPv6 visitors are counted per /64 block.
- `PUBLIC_URL`: the site's public address, such as `https://trade-check.example.com`. Used for the link-preview URL. On Render, `RENDER_EXTERNAL_URL` is used when this is not set. Without either, the preview has no URL.
- `TRADE_CHECK_MODEL`: default `claude-opus-5-5`.
- `PORT`: default 8787.

## Put it online

The repo includes `render.yaml`, so Render can set everything up:

1. Sign in at [render.com](https://render.com) with GitHub.
2. Choose **New**, then **Blueprint**, and pick this repo. (If it isn't listed, let Render access the repo under its GitHub settings.)
3. Paste your Anthropic API key when Render asks for `ANTHROPIC_API_KEY`, then click **Apply**.
4. When the build finishes, open the `onrender.com` link Render shows.

The free plan sleeps when idle, so the first visit after a quiet spell can take up to a minute to load. Any other Node host works too (Railway, Fly.io): start command `npm start`, with `ANTHROPIC_API_KEY` set as a secret. Never put the key in `index.html`.

Set a monthly spend limit in the Anthropic Console before sharing the link.

## How a check works

`server.js` sends the photos and text to Claude with the web search tool turned on (up to 5 searches per check). Claude identifies the cards, searches recent sold prices, checks for scam patterns and visible counterfeit signs, and answers in JSON. The page renders that JSON.

The server only accepts checks from its own page: `POST /api/check` must be JSON (`content-type: application/json`) and same-origin. A request body over 9 MB is refused. A check stops after 140 seconds, and stops at once if the visitor closes the page or presses Stop, so no credits are spent on an answer nobody will see. Requests that are malformed or refused don't count toward the hourly limits.

The page is served with link-preview tags (description, Open Graph, Twitter card) and a small icon, so a shared link shows a title and a one-line pitch. There is no preview image yet. The page is cached in memory and sent with an ETag, so repeat visits get a quick `304 Not Modified`.

Cost per check has not been measured yet. It depends on photo count and how many searches Claude runs. Watch the Usage page in the Anthropic Console after the first few real checks.

## Limits

- It is a risk check, not an authentication. Photos can't prove a card is real.
- The rate limit is kept in memory, so it resets when the server restarts.
- The saved result image shows the card window from your first photo. Without a photo, it shows stand-in art and says so.
