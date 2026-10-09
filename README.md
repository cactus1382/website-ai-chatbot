# SiteChat AI — a chatbot that actually knows your business

A done-for-you AI support chatbot for small businesses. You point it at your website, it reads every page, and then it answers your visitors' questions **using only what it read**. One line of code on your site. No build step, no database, no vendor lock-in.

The whole product is the guarantee: **it cannot invent a fact.** If a visitor asks something that isn't on your site, it says it's not certain and asks for their email or phone number so you can follow up. For a restaurant quoting the wrong price, or a clinic saying "yes we're open" on a closed day, that's a liability — so the guardrails are the product.

## What it does

- **Trains itself on your website.** One API call with your URL; it crawls up to 25 of your own pages and stores them.
- **Answers from that content only.** Prices, hours, menu, location, policies — whatever you published.
- **Escalates instead of guessing.** When it can't answer, it collects the visitor's contact details and hands them to you.
- **One-line embed.** A single `<script>` tag adds a chat bubble to any site, no framework needed.
- **Works with any AI provider.** OpenAI, OpenRouter, or any OpenAI-compatible endpoint (set `OPENAI_BASE_URL`).
- **Zero dependencies at runtime** apart from Express and the OpenAI SDK. `npm install` on a laptop with no compiler.

## Who it's for

Restaurants, clinics, salons, gyms, law offices, agencies — any business whose website already answers the same ten questions every day, and loses the customers who won't dig through a menu page to find them.

## Quick start

```bash
git clone https://github.com/cactus1382/website-ai-chatbot.git
cd website-ai-chatbot
cp .env.example .env
npm install
```

Fill in `.env`:

```bash
OPENAI_API_KEY=sk-...             # or an OpenRouter key
OPENAI_BASE_URL=                  # e.g. https://openrouter.ai/api/v1 (blank = OpenAI)
MODEL=gpt-4o-mini
ADMIN_KEY=                        # node -e "console.log(require('crypto').randomUUID())"
```

Start it:

```bash
npm start          # listens on :3009
```

Train it on your site (one call, admin-gated):

```bash
curl -X POST http://localhost:3009/api/mybusiness/ingest \
  -H "content-type: application/json" \
  -H "x-admin-key: $ADMIN_KEY" \
  -d '{"url": "https://myrestaurant.com"}'
```

Add it to your site (one line):

```html
<script src="https://your-host/widget/embed.js" data-site="mybusiness"></script>
```
That's it. Your visitors get a chat bubble that answers from your real content.

## Run with Docker

```bash
cp .env.example .env   # fill it in
docker compose up -d --build
```

## How it stays honest

The system prompt forbids inventing prices, hours, availability, allergen claims, wait times, or policies, and forbids promising refunds, discounts, reservations, or callbacks unless your content says so. Only the top-scoring chunks of your own pages are sent to the model as context. If the answer isn't in them, the bot says so and captures a lead instead. On any API failure it degrades to lead capture rather than going silent or guessing.

## Project layout

```
.
├── src/
│   ├── index.js        # express server: chat, lead, ingest, config, widget
│   ├── chatbot.js      # retrieval + LLM call + escalation
│   ├── scraper.js      # crawls a site into the knowledge base
│   ├── prompts.js      # the guardrail system prompt
│   ├── store.js        # zero-dependency JSON persistence (atomic writes)
│   └── widget.js       # the embeddable chat bubble (served at /widget/embed.js)
├── data/homefoodpro/   # a worked example: an ingested restaurant site
├── test/e2e.js         # 39 assertions, fully offline
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

## Tests

```bash
npm test
```

39 assertions, all offline (the LLM and HTTP are stubbed): chat grounding, session continuity, escalation, lead capture and persistence, admin gating, site ingestion and link following, widget delivery, and graceful degradation on API failure.

## Honest limitations

- Retrieval is pure keyword scoring over your site's text — no embeddings, no vector DB. It is deliberately simple; for a typical small-business site it is enough, and it keeps the install dependency-free.
- It answers text only, in one language per turn (it matches the visitor's language).
- The widget has no analytics dashboard; leads are stored as JSON and optionally pushed to a Telegram chat.
- One site per folder under `data/`. Multiple clients = multiple folders, or multiple instances.

## License

MIT — see [LICENSE.txt](LICENSE.txt).
