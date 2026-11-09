require("dotenv").config();
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { parseReceipt, aiEnabled, MODEL } = require("./lib/ai");
const { splitBill } = require("./lib/split");
const paypal = require("./lib/paypal");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- tiny JSON-file store (good enough for a hackathon demo) ----
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "splits.json");
let splits = {};
try { splits = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { splits = {}; }
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(splits, null, 2));
}
const newId = () => crypto.randomBytes(6).toString("base64url");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

// Remove server-only details before sending a split to the browser.
function publicSplit(s) {
  return {
    id: s.id, merchant: s.merchant, currency: s.currency, payer: s.payer, total: s.total,
    createdAt: s.createdAt,
    shares: s.shares.map(({ name, subtotal, extras, total, items, status, payToken, paidAt, simulated }) =>
      ({ name, subtotal, extras, total, items, status, payToken, paidAt, simulated })),
  };
}

app.get("/api/config", (req, res) => {
  res.json({
    aiEnabled: aiEnabled(),
    model: MODEL,
    paypalEnabled: paypal.paypalEnabled(),
    paypalClientId: paypal.paypalEnabled() ? paypal.clientId() : null,
  });
});

// 1) AI: read a receipt photo/PDF and/or a text description
app.post("/api/parse", upload.single("receipt"), async (req, res) => {
  try {
    let image;
    if (req.file) {
      if (!ALLOWED_TYPES.includes(req.file.mimetype)) {
        return res.status(400).json({ error: "Upload a JPG, PNG, GIF, WEBP or PDF." });
      }
      image = { data: req.file.buffer.toString("base64"), mediaType: req.file.mimetype };
    }
    const text = req.body?.text || "";
    if (!image && !text.trim() && aiEnabled()) {
      return res.status(400).json({ error: "Add a receipt photo or describe the expenses." });
    }
    res.json(await parseReceipt({ text, image }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2) Preview the split (pure math, no side effects)
app.post("/api/preview", (req, res) => {
  try {
    const { receipt, people, assignments } = req.body;
    res.json(splitBill(receipt, people, assignments));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3) Create the split + one payment link per person who owes the payer
app.post("/api/splits", (req, res) => {
  try {
    const { receipt, people, assignments, payer, payerEmail } = req.body;
    if (!payer || !people.includes(payer)) throw new Error("Choose who paid the bill.");
    const result = splitBill(receipt, people, assignments);
    const id = newId();
    const split = {
      id,
      merchant: receipt.merchant || "Shared bill",
      currency: (receipt.currency || "USD").toUpperCase(),
      payer,
      payerEmail: payerEmail || null,
      total: result.total,
      createdAt: new Date().toISOString(),
      shares: result.shares.map((s) => ({
        ...s,
        status: s.name === payer ? "payer" : Number(s.total) > 0 ? "pending" : "nothing_owed",
        payToken: s.name === payer ? null : newId(),
        orderId: null,
      })),
    };
    splits[id] = split;
    save();
    res.json(publicSplit(split));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/splits/:id", (req, res) => {
  const s = splits[req.params.id];
  if (!s) return res.status(404).json({ error: "Split not found" });
  res.json(publicSplit(s));
});

function findShare(id, token) {
  const split = splits[id];
  const share = split?.shares.find((x) => x.payToken && x.payToken === token);
  return { split, share };
}

app.get("/api/splits/:id/pay/:token", (req, res) => {
  const { split, share } = findShare(req.params.id, req.params.token);
  if (!share) return res.status(404).json({ error: "Payment link not found" });
  res.json({ split: publicSplit(split), share: publicSplit(split).shares.find((x) => x.payToken === share.payToken) });
});

// 4) PayPal: create the order for this person's share
app.post("/api/splits/:id/pay/:token/order", async (req, res) => {
  const { split, share } = findShare(req.params.id, req.params.token);
  if (!share) return res.status(404).json({ error: "Payment link not found" });
  if (share.status === "paid") return res.status(409).json({ error: "Already paid" });
  try {
    const order = await paypal.createOrder({
      amount: share.total,
      currency: split.currency,
      description: `SplitPal: ${share.name}'s share of ${split.merchant}, owed to ${split.payer}`,
      referenceId: `${split.id}-${share.payToken}`,
      payeeEmail: split.payerEmail,
    });
    share.orderId = order.id;
    save();
    res.json({ id: order.id });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// 5) PayPal: capture after the friend approves in the PayPal popup
app.post("/api/splits/:id/pay/:token/capture", async (req, res) => {
  const { split, share } = findShare(req.params.id, req.params.token);
  if (!share) return res.status(404).json({ error: "Payment link not found" });
  const orderId = req.body?.orderId;
  if (!orderId || orderId !== share.orderId) return res.status(400).json({ error: "Unknown order" });
  try {
    const result = await paypal.captureOrder(orderId);
    const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
    if (result.status !== "COMPLETED" || capture?.status !== "COMPLETED") {
      return res.status(402).json({ error: `Payment not completed (${capture?.status || result.status})` });
    }
    share.status = "paid";
    share.paidAt = new Date().toISOString();
    share.captureId = capture.id;
    save();
    res.json({ ok: true, captureId: capture.id });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// Demo mode only: mark as paid without PayPal so the flow can be shown without keys
app.post("/api/splits/:id/pay/:token/simulate", (req, res) => {
  if (paypal.paypalEnabled()) return res.status(403).json({ error: "Simulation is disabled when PayPal is configured" });
  const { share } = findShare(req.params.id, req.params.token);
  if (!share) return res.status(404).json({ error: "Payment link not found" });
  share.status = "paid";
  share.paidAt = new Date().toISOString();
  share.simulated = true;
  save();
  res.json({ ok: true });
});

app.get("/split/:id", (req, res) => res.sendFile(path.join(__dirname, "public", "split.html")));
app.get("/pay/:id/:token", (req, res) => res.sendFile(path.join(__dirname, "public", "pay.html")));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SplitPal running on http://localhost:${PORT}`);
    console.log(`  AI (Claude): ${aiEnabled() ? `on (${MODEL})` : "demo mode - set ANTHROPIC_API_KEY"}`);
    console.log(`  PayPal:      ${paypal.paypalEnabled() ? "sandbox" : "demo mode - set PAYPAL_CLIENT_ID/SECRET"}`);
  });
}

module.exports = app;
