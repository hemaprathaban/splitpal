# SplitPal

**Snap a receipt. AI splits it fairly. Friends pay you back with PayPal.**

SplitPal turns the most awkward part of eating out, working out who owes what, into a 30-second flow:

1. **Add the bill**: upload a receipt photo (or PDF), or just describe it in plain English:
   *"Dinner was $84 plus $12 tip. Ana had the $15 salad, Raj and I shared the rest."*
2. **AI reads it**: every line item, tax, tip and fee is extracted, and if you said who had what, items are pre-assigned.
3. **Fix anything, tap names to assign items**: shared items are split evenly, and tax, tip and fees are split in proportion to what each person ordered.
4. **Get one PayPal payment link per friend**: each link opens a PayPal checkout for exactly that person's share, paid straight to whoever covered the bill.
5. **Watch it settle**: a live tracker shows who has paid and how much is still outstanding.

Built for the **PayPal AI Hackathon**.

---

## How PayPal is used

| PayPal tool | What it does in SplitPal |
|---|---|
| **PayPal REST API, OAuth 2.0** (`/v1/oauth2/token`) | Server gets an access token with the sandbox app's client ID/secret (cached until expiry). |
| **Orders API v2: create** (`POST /v2/checkout/orders`) | Creates one `CAPTURE` order per friend for their exact share. If the payer gives their PayPal email, it is set as the order's `payee`, so the money goes straight to them. A `PayPal-Request-Id` makes creation idempotent. |
| **PayPal JavaScript SDK (Smart Payment Buttons)** | Renders the PayPal / card buttons on each friend's payment page; the friend approves in the PayPal popup. |
| **Orders API v2: capture** (`POST /v2/checkout/orders/{id}/capture`) | Captures the approved order server-side and only marks the share as paid when the capture status is `COMPLETED`. |
| **PayPal Sandbox** | All payments run against `api-m.sandbox.paypal.com` with sandbox buyer/seller accounts, so no real money moves. |

Code: [`lib/paypal.js`](lib/paypal.js), payment routes in [`server.js`](server.js), buttons in [`public/pay.html`](public/pay.html).

## How AI is used

| AI tool | What it does in SplitPal |
|---|---|
| **Claude (Anthropic API, model `claude-opus-5-5`)** | Reads receipt **images and PDFs** (vision) and **free-text descriptions**, and returns the merchant, currency, line items, tax, tip, fees, people mentioned and who had which item. |
| **Structured outputs** (`output_config.format` with a JSON schema) | Guarantees the model returns valid JSON matching SplitPal's receipt schema, so there is no fragile text parsing. |
| **Server-side fallback** (`fallbacks: "default"`) | If a request is declined, the API automatically retries it on a fallback model. |

The AI only *reads* the bill. All money math is plain, deterministic code ([`lib/split.js`](lib/split.js)) that works in integer cents with largest-remainder rounding, so shares always add up to the exact receipt total. Users review and can edit every item before any payment link is created.

Code: [`lib/ai.js`](lib/ai.js).

## Tech stack

Node.js 20+, Express, Multer (uploads), Anthropic TypeScript/JavaScript SDK, PayPal REST APIs + JavaScript SDK, vanilla HTML/CSS/JS front end (no build step), Node's built-in test runner. Deployable to **Render** with the included `render.yaml`.

---

## Run it locally

```bash
git clone https://github.com/hemaprathaban/splitpal.git
cd splitpal
npm install
cp .env.example .env     # then fill in the keys below
npm start                # http://localhost:3000
```

### Keys

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API keys |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) → Apps & Credentials → **Sandbox** → create an app |

**No keys? It still runs.** Without `ANTHROPIC_API_KEY` a sample receipt is used, and without PayPal keys the payment page shows a simulated "Pay" button, so you can try the full flow first.

### Testing payments in the sandbox

1. In the PayPal developer dashboard, open **Testing Tools → Sandbox Accounts**. You get a *Personal* (buyer) and a *Business* (seller) account.
2. On the "Who owes what" step, put the **Business** sandbox email as the payer's PayPal email (optional; without it, money goes to the app's own sandbox account).
3. Open a friend's payment link, click **PayPal**, and log in with the **Personal** sandbox account to pay.
4. The tracker page flips that person to **Paid**.

### Tests

```bash
npm test
```

## Deploy (Render)

1. Push this repo to GitHub, then in Render choose **New → Blueprint** and select the repo (it reads `render.yaml`).
2. Set `ANTHROPIC_API_KEY`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the service's environment.

Splits are stored in a JSON file (`data/splits.json`). That's fine for a demo, but on free hosting it resets when the service restarts.

## Project structure

```
server.js          Express API + routes
lib/ai.js          Receipt reading with Claude (structured JSON output)
lib/paypal.js      PayPal OAuth + Orders v2 (create / capture)
lib/split.js       Fair-split math in integer cents
public/index.html  Add bill → assign items → create links
public/split.html  Live "who has paid" tracker
public/pay.html    A friend's payment page with PayPal buttons
test/              Unit tests for the split math
```

## What's next

- Recurring splits for roommates (rent, utilities)
- PayPal Payouts for the payer to reimburse group expenses in one batch
- Group chat bot: forward a receipt photo, get links back

## License

[MIT](LICENSE)
