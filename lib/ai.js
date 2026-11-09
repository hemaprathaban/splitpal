// Receipt understanding with Claude (Anthropic API).
// Turns a receipt photo or a plain-English description of expenses into
// structured line items. Falls back to a sample receipt in demo mode.

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["merchant", "currency", "items", "tax", "tip", "fees", "people_mentioned", "suggested_assignments", "notes"],
  properties: {
    merchant: { type: "string", description: "Store or restaurant name, or a short label like 'Pizza night'" },
    currency: { type: "string", description: "ISO 4217 code, e.g. USD" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "price"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          price: { type: "number", description: "Line total for this item (quantity already applied)" },
        },
      },
    },
    tax: { type: "number" },
    tip: { type: "number" },
    fees: { type: "number", description: "Service charges, delivery fees, etc." },
    people_mentioned: { type: "array", items: { type: "string" }, description: "Names mentioned in the description, if any" },
    suggested_assignments: {
      type: "array",
      description: "Who had which item, only when the user said so",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_index", "people"],
        properties: {
          item_index: { type: "integer" },
          people: { type: "array", items: { type: "string" } },
        },
      },
    },
    notes: { type: "string", description: "Anything unclear or worth double-checking; empty string if none" },
  },
};

const SYSTEM = `You extract bills for SplitPal, a bill-splitting app.
Read the receipt image or the user's description and return every purchased line item with its line total.
Put tax, tip and service/delivery fees in their own fields, never as items. Use 0 when absent.
Do not include subtotal or total lines as items. If the user says who had what, fill suggested_assignments
using 0-based item indexes and the names they used ("me"/"I" stays "Me"). Never invent prices: if a price is unreadable,
make your best estimate and say so in notes.`;

const DEMO_RECEIPT = {
  merchant: "Luigi's Pizzeria (demo)",
  currency: "USD",
  items: [
    { name: "Margherita pizza", quantity: 1, price: 18.5 },
    { name: "Pepperoni pizza", quantity: 1, price: 21.0 },
    { name: "Caesar salad", quantity: 1, price: 11.25 },
    { name: "Garlic knots", quantity: 2, price: 9.0 },
    { name: "Lemonade", quantity: 3, price: 12.75 },
  ],
  tax: 6.31,
  tip: 14.5,
  fees: 0,
  people_mentioned: ["Me", "Ana", "Raj"],
  suggested_assignments: [{ item_index: 2, people: ["Ana"] }],
  notes: "Demo mode: set ANTHROPIC_API_KEY to read your own receipts.",
};

const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * @param {{ text?: string, image?: { data: string, mediaType: string } }} input
 */
async function parseReceipt({ text, image }) {
  if (!aiEnabled()) return { ...DEMO_RECEIPT, demo: true };

  const content = [];
  if (image) {
    const isPdf = image.mediaType === "application/pdf";
    content.push({
      type: isPdf ? "document" : "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  content.push({
    type: "text",
    text: text && text.trim() ? text.trim() : "Extract this receipt.",
  });

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: RECEIPT_SCHEMA },
    },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI couldn't process this receipt. Try a clearer photo or type the items.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Receipt was too long to read in one go. Try cropping it.");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No result from AI.");
  return JSON.parse(textBlock.text);
}

module.exports = { parseReceipt, aiEnabled, MODEL };
