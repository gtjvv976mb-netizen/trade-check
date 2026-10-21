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

Cost per check has not been measured yet. It depends on photo count and how many searches Claude runs. Watch the Usage page in the Anthropic Console after the first few real checks.

## Limits

- It is a risk check, not an authentication. Photos can't prove a card is real.
- The rate limit is kept in memory, so it resets when the server restarts.
