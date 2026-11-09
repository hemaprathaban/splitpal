const test = require("node:test");
const assert = require("node:assert");
const { splitBill, distribute } = require("../lib/split");

const cents = (s) => Math.round(Number(s) * 100);

test("distribute always sums to the exact amount", () => {
  assert.deepStrictEqual(distribute(100, [1, 1, 1]), [34, 33, 33]);
  assert.strictEqual(distribute(1001, [3, 5, 7]).reduce((a, b) => a + b), 1001);
  assert.deepStrictEqual(distribute(0, [1, 2]), [0, 0]);
});

test("unassigned items are shared by everyone", () => {
  const r = splitBill({ items: [{ name: "Pizza", price: 30 }], tax: 0, tip: 0 }, ["A", "B", "C"]);
  assert.deepStrictEqual(r.shares.map((s) => s.total), ["10.00", "10.00", "10.00"]);
  assert.strictEqual(r.total, "30.00");
});

test("assigned items go only to their people; tax/tip are proportional", () => {
  const receipt = {
    items: [{ name: "Steak", price: 40 }, { name: "Salad", price: 10 }],
    tax: 5, tip: 10,
  };
  const r = splitBill(receipt, ["Me", "Ana"], { 0: ["Me"], 1: ["Ana"] });
  const me = r.shares.find((s) => s.name === "Me");
  const ana = r.shares.find((s) => s.name === "Ana");
  assert.strictEqual(me.total, "52.00"); // 40 + 80% of 15
  assert.strictEqual(ana.total, "13.00"); // 10 + 20% of 15
  assert.strictEqual(r.total, "65.00");
});

test("odd cents never get lost", () => {
  const receipt = { items: [{ name: "A", price: 10.01 }, { name: "B", price: 3.33 }], tax: 1.07, tip: 2.02, fees: 0.99 };
  const r = splitBill(receipt, ["X", "Y", "Z"], { 1: ["X", "Z"] });
  const sum = r.shares.reduce((a, s) => a + cents(s.total), 0);
  assert.strictEqual(sum, cents(10.01) + cents(3.33) + cents(1.07) + cents(2.02) + cents(0.99));
});

test("needs at least one person", () => {
  assert.throws(() => splitBill({ items: [] }, []), /at least one person/);
});
