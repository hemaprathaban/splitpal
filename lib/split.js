// Pure bill-splitting math. All money is handled in integer cents so shares
// always add up to the exact receipt total.

const toCents = (n) => Math.round(Number(n || 0) * 100);
const fromCents = (c) => (c / 100).toFixed(2);

/**
 * Split a receipt among people.
 *
 * @param {object} receipt  { items: [{ name, price, quantity? }], tax, tip, fees? }
 * @param {string[]} people names, e.g. ["Ana", "Raj", "Me"]
 * @param {object} assignments map of item index -> array of names sharing it.
 *        Items with no assignment are shared by everyone.
 * @returns {{ total: string, shares: { name, subtotal, extras, total, items }[] }}
 */
function splitBill(receipt, people, assignments = {}) {
  if (!Array.isArray(people) || people.length === 0) {
    throw new Error("Add at least one person to split with.");
  }
  const names = [...new Set(people.map((p) => String(p).trim()).filter(Boolean))];
  if (names.length === 0) throw new Error("Add at least one person to split with.");

  const owed = Object.fromEntries(names.map((n) => [n, { sub: 0, items: [] }]));

  (receipt.items || []).forEach((item, idx) => {
    const lineCents = toCents(item.price); // price is the line total for this item
    let sharers = (assignments[idx] || []).filter((n) => owed[n]);
    if (sharers.length === 0) sharers = names;
    const parts = distribute(lineCents, sharers.map(() => 1));
    sharers.forEach((n, i) => {
      owed[n].sub += parts[i];
      owed[n].items.push({ name: item.name, amount: fromCents(parts[i]), sharedWith: sharers.length });
    });
  });

  // Tax, tip and fees are split in proportion to what each person ordered.
  const extrasCents = toCents(receipt.tax) + toCents(receipt.tip) + toCents(receipt.fees);
  const subtotals = names.map((n) => owed[n].sub);
  const weights = subtotals.some((s) => s > 0) ? subtotals : names.map(() => 1);
  const extraParts = distribute(extrasCents, weights);

  const shares = names.map((n, i) => ({
    name: n,
    subtotal: fromCents(owed[n].sub),
    extras: fromCents(extraParts[i]),
    total: fromCents(owed[n].sub + extraParts[i]),
    items: owed[n].items,
  }));
  const total = shares.reduce((s, x) => s + toCents(x.total), 0);
  return { total: fromCents(total), shares };
}

/** Split `cents` by weights using largest-remainder rounding (sum is exact). */
function distribute(cents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || cents === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (cents * w) / sum);
  const floors = raw.map(Math.floor);
  let left = cents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floors[order[k][1]]++;
  return floors;
}

module.exports = { splitBill, distribute, toCents, fromCents };
