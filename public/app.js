// SplitPal front end: parse -> review/assign -> create payment links
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  people: ["Me"],
  receipt: { merchant: "", currency: "USD", items: [], tax: 0, tip: 0, fees: 0 },
  assignments: {}, // item index -> [names]
};
let file = null;

// ---------- config / demo-mode banner ----------
fetch("/api/config").then((r) => r.json()).then((cfg) => {
  const msgs = [];
  if (!cfg.aiEnabled) msgs.push("AI is in demo mode, so a sample receipt is used.");
  if (!cfg.paypalEnabled) msgs.push("PayPal is in demo mode, so payments are simulated.");
  if (msgs.length) { $("modeNote").textContent = msgs.join(" ") + " Add API keys in .env to go live."; $("modeNote").classList.remove("hidden"); }
});

// ---------- step 1: upload / describe ----------
$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => {
  file = e.target.files[0] || null;
  $("drop").classList.toggle("has-file", !!file);
  if (file && file.type.startsWith("image/")) {
    $("preview").src = URL.createObjectURL(file);
    $("preview").classList.remove("hidden");
    $("dropText").innerHTML = `<strong>${esc(file.name)}</strong>`;
  } else if (file) {
    $("preview").classList.add("hidden");
    $("dropText").innerHTML = `<strong>${esc(file.name)}</strong>`;
  }
});

$("parseBtn").addEventListener("click", async () => {
  const btn = $("parseBtn");
  $("parseErr").textContent = "";
  btn.disabled = true; btn.textContent = "Reading your bill...";
  try {
    const fd = new FormData();
    if (file) fd.append("receipt", file);
    fd.append("text", $("desc").value);
    const res = await fetch("/api/parse", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not read the bill");
    loadReceipt(data);
  } catch (err) {
    $("parseErr").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Read my bill";
  }
});

$("manualBtn").addEventListener("click", () => {
  loadReceipt({ merchant: "Shared bill", currency: "USD", items: [{ name: "", price: 0, quantity: 1 }], tax: 0, tip: 0, fees: 0 });
});

function loadReceipt(r) {
  state.receipt = {
    merchant: r.merchant || "Shared bill",
    currency: r.currency || "USD",
    items: (r.items || []).map((i) => ({ name: i.name, price: Number(i.price) || 0, quantity: i.quantity || 1 })),
    tax: r.tax || 0, tip: r.tip || 0, fees: r.fees || 0,
  };
  const mentioned = (r.people_mentioned || []).map(normName).filter(Boolean);
  for (const n of mentioned) if (!state.people.includes(n)) state.people.push(n);
  state.assignments = {};
  for (const a of r.suggested_assignments || []) {
    const names = a.people.map(normName).filter((n) => state.people.includes(n));
    if (names.length && state.receipt.items[a.item_index]) state.assignments[a.item_index] = names;
  }
  $("merchant").value = state.receipt.merchant;
  $("currency").value = state.receipt.currency;
  $("tax").value = state.receipt.tax; $("tip").value = state.receipt.tip; $("fees").value = state.receipt.fees;
  if (r.notes) { $("aiNotes").textContent = r.notes; $("aiNotes").classList.remove("hidden"); } else $("aiNotes").classList.add("hidden");
  $("step2").classList.remove("hidden"); $("step3").classList.remove("hidden");
  render();
  $("step2").scrollIntoView({ behavior: "smooth" });
}

function normName(n) {
  const s = String(n || "").trim();
  if (/^(me|i|myself)$/i.test(s)) return "Me";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- step 2: people + items ----------
function addPerson() {
  const n = normName($("personName").value);
  if (n && !state.people.includes(n)) state.people.push(n);
  $("personName").value = "";
  render();
}
$("addPerson").addEventListener("click", addPerson);
$("personName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } });

$("addItem").addEventListener("click", () => { state.receipt.items.push({ name: "", price: 0, quantity: 1 }); render(); });
for (const id of ["tax", "tip", "fees"]) $(id).addEventListener("input", () => { state.receipt[id] = Number($(id).value) || 0; refreshPreview(); });
$("merchant").addEventListener("input", () => (state.receipt.merchant = $("merchant").value));
$("currency").addEventListener("change", () => { state.receipt.currency = $("currency").value; refreshPreview(); });

function render() {
  $("peopleChips").innerHTML = state.people
    .map((p, i) => `<span class="chip on">${esc(p)}${state.people.length > 1 ? `<span class="x" data-rm="${i}" title="Remove">&times;</span>` : ""}</span>`)
    .join("");
  $("peopleChips").querySelectorAll("[data-rm]").forEach((x) =>
    x.addEventListener("click", () => {
      const name = state.people[x.dataset.rm];
      state.people.splice(x.dataset.rm, 1);
      for (const k in state.assignments) state.assignments[k] = state.assignments[k].filter((n) => n !== name);
      render();
    }));

  $("items").innerHTML = state.receipt.items.map((it, i) => `
    <tr>
      <td><input type="text" data-f="name" data-i="${i}" value="${esc(it.name)}" placeholder="Item" /></td>
      <td class="num"><input type="number" step="0.01" min="0" data-f="price" data-i="${i}" value="${it.price}" /></td>
      <td><div class="chips">${state.people.map((p) =>
        `<span class="chip ${(state.assignments[i] || []).includes(p) ? "on" : ""}" data-i="${i}" data-p="${esc(p)}">${esc(p)}</span>`).join("")}</div></td>
      <td><button class="link" data-del="${i}" title="Remove item">&times;</button></td>
    </tr>`).join("");

  $("items").querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("input", () => {
      const it = state.receipt.items[inp.dataset.i];
      it[inp.dataset.f] = inp.dataset.f === "price" ? Number(inp.value) || 0 : inp.value;
      refreshPreview();
    }));
  $("items").querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const i = c.dataset.i, p = c.dataset.p;
      const cur = new Set(state.assignments[i] || []);
      cur.has(p) ? cur.delete(p) : cur.add(p);
      state.assignments[i] = [...cur];
      render();
    }));
  $("items").querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const del = Number(b.dataset.del);
      state.receipt.items.splice(del, 1);
      const next = {};
      for (const [k, v] of Object.entries(state.assignments)) {
        const idx = Number(k);
        if (idx < del) next[idx] = v; else if (idx > del) next[idx - 1] = v;
      }
      state.assignments = next;
      render();
    }));

  const prevPayer = $("payer").value;
  $("payer").innerHTML = state.people.map((p) => `<option ${p === prevPayer ? "selected" : ""}>${esc(p)}</option>`).join("");
  refreshPreview();
}

// ---------- step 3: preview + create ----------
let previewTimer;
function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const res = await fetch("/api/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt: state.receipt, people: state.people, assignments: state.assignments }),
    });
    const data = await res.json();
    if (!res.ok) { $("previewShares").innerHTML = `<div class="error">${esc(data.error)}</div>`; return; }
    const cur = state.receipt.currency;
    $("previewShares").innerHTML = `
      <table><thead><tr><th>Person</th><th class="num hide-sm">Items</th><th class="num hide-sm">Tax/tip/fees</th><th class="num">Owes</th></tr></thead>
      <tbody>${data.shares.map((s) => `<tr><td>${esc(s.name)}</td><td class="num hide-sm">${s.subtotal}</td><td class="num hide-sm">${s.extras}</td><td class="num"><strong>${s.total} ${esc(cur)}</strong></td></tr>`).join("")}
      <tr><td><strong>Total</strong></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="num"><strong>${data.total} ${esc(cur)}</strong></td></tr></tbody></table>`;
  }, 150);
}

$("createBtn").addEventListener("click", async () => {
  const btn = $("createBtn");
  $("createErr").textContent = "";
  btn.disabled = true;
  try {
    const res = await fetch("/api/splits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt: state.receipt, people: state.people, assignments: state.assignments,
        payer: $("payer").value, payerEmail: $("payerEmail").value.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    location.href = `/split/${data.id}`;
  } catch (err) {
    $("createErr").textContent = err.message;
    btn.disabled = false;
  }
});
