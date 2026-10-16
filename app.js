const FIELD_KEYS = ["aov", "refundRate", "cogs", "shipping", "paymentFees", "other", "cac", "ordersPerMonth", "fixedCosts", "currency"];

const DEFAULTS = { currency: "$", aov: 74.5, refundRate: 2.5, cogs: 22, shipping: 6.8, paymentFees: 2.9, other: 1.4, cac: 28, ordersPerMonth: 1800, fixedCosts: 19000 };

const FIELD_ALIASES = {
  "average order value": "aov", "aov": "aov", "order value": "aov", "selling price": "aov",
  "refund rate": "refundRate", "refundrate": "refundRate", "returns rate": "refundRate", "return rate": "refundRate",
  "product cost": "cogs", "cogs": "cogs", "cost of goods": "cogs", "cost of goods sold": "cogs",
  "shipping": "shipping", "shipping and fulfilment": "shipping", "shipping and fulfillment": "shipping",
  "fulfilment": "shipping", "fulfillment": "shipping", "shipping cost": "shipping",
  "payment fees": "paymentFees", "paymentfees": "paymentFees", "processing fees": "paymentFees", "transaction fees": "paymentFees",
  "other variable costs": "other", "other": "other", "othervariablecosts": "other", "other costs": "other",
  "cost to acquire a customer": "cac", "cac": "cac", "customer acquisition cost": "cac", "acquisition cost": "cac",
  "orders per month": "ordersPerMonth", "orderspermonth": "ordersPerMonth", "monthly orders": "ordersPerMonth",
  "fixed costs per month": "fixedCosts", "fixedcosts": "fixedCosts", "fixed costs": "fixedCosts", "monthly fixed costs": "fixedCosts",
  "currency": "currency", "currency symbol": "currency"
};

const AI_PROMPT = `Pull the figures for my Shopify store and reply with a JSON object only: no explanation, no code fences, no extra keys.

{
  "currency": "$",
  "aov": 0,
  "refundRate": 0,
  "cogs": 0,
  "shipping": 0,
  "paymentFees": 0,
  "other": 0,
  "cac": 0,
  "ordersPerMonth": 0,
  "fixedCosts": 0
}

What each one means. "aov" is average order value over the last 90 days, after discounts, before refunds. "refundRate" is refunds as a percentage of revenue, as a plain number like 2.5. "cogs" is the average product cost in one order: what you paid your supplier, not what you sell it for. "shipping" is the average shipping and fulfilment cost you pay per order, including pick and pack. "paymentFees" is your payment processing rate as a percentage, like 2.9. "other" is any remaining per-order cost such as packaging inserts, custom packaging or per-order app fees. "cac" is total ad spend divided by new customers over the same period. "ordersPerMonth" is average monthly orders. "fixedCosts" is monthly rent, salaries and software: anything paid whether you sell one order or a thousand.

Every money figure is a plain number in one currency, with no symbol, commas or spaces. Percentages are plain numbers, so 2.9 not 0.029. Use 0 for anything you genuinely cannot find, and never estimate or invent a figure.

My store is:`;

const form = document.querySelector("#cmForm");
const resultsSection = document.querySelector("#resultsSection");
const heroEl = document.querySelector("#hero");
const ladderEl = document.querySelector("#ladder");
const breakevenEl = document.querySelector("#breakeven");
const monthlyEl = document.querySelector("#monthly");
const footNoteEl = document.querySelector("#footNote");
const toast = document.querySelector("#toast");
let fillToken = 0;

/* ---------- reading ---------- */

function num(name) {
  const value = Number(form.elements[name] && form.elements[name].value);
  return isFinite(value) && value > 0 ? value : 0;
}

function getInputs() {
  const data = {};
  FIELD_KEYS.forEach(key => data[key] = key === "currency" ? (form.elements[key].value || "").trim() : num(key));
  data.currency = data.currency || "$";
  return data;
}

/* ---------- maths ---------- */

function compute(d) {
  const netAov = d.aov * (1 - Math.min(d.refundRate, 100) / 100);
  const refundLoss = d.aov - netAov;
  const feeAmount = netAov * (d.paymentFees / 100);
  const cm1 = netAov - d.cogs;
  const cm2 = cm1 - d.shipping - feeAmount - d.other;
  const cm3 = cm2 - d.cac;
  return {
    netAov, refundLoss, feeAmount, cm1, cm2, cm3,
    cm1Pct: netAov ? cm1 / netAov : 0,
    cm2Pct: netAov ? cm2 / netAov : 0,
    cm3Pct: netAov ? cm3 / netAov : 0,
    breakEvenCac: cm2,
    // what the ad platform has to report: full order value, the same way the training and the Offer Simulator work it out
    breakEvenRoas: cm2 > 0 ? d.aov / cm2 : 0,
    monthlyContribution: cm3 * d.ordersPerMonth,
    monthlyProfit: cm3 * d.ordersPerMonth - d.fixedCosts,
    breakEvenOrders: cm3 > 0 ? d.fixedCosts / cm3 : 0
  };
}

/* ---------- formatting ---------- */

function money(value, currency) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const big = abs >= 1000;
  const rounded = big ? Math.round(abs) : Math.round(abs * 100) / 100;
  const text = rounded.toLocaleString("en-US", {
    minimumFractionDigits: big ? 0 : 2,
    maximumFractionDigits: big ? 0 : 2
  });
  return `${sign}${currency}${text}`;
}

function pct(value) {
  return (value * 100).toFixed(1) + "%";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

/* ---------- rendering ---------- */

function row(label, amount, percent, className) {
  return `<tr class="${className || ""}"><td>${label}</td><td>${amount}</td><td class="pct">${percent || ""}</td></tr>`;
}

function render() {
  const d = getInputs();
  if (!d.aov) {
    resultsSection.hidden = true;
    return;
  }
  const c = compute(d);
  const cur = escapeHtml(d.currency);
  resultsSection.hidden = false;

  const hasCac = d.cac > 0;
  const headline = hasCac ? c.cm3 : c.cm2;
  const headlinePct = hasCac ? c.cm3Pct : c.cm2Pct;

  heroEl.innerHTML = `
    <p class="hero-label">Contribution margin per order</p>
    <p class="hero-value">${money(headline, cur)}</p>
    <p class="hero-note">${pct(headlinePct)} of net revenue${hasCac ? "" : ". Add your acquisition cost to see the real figure"}</p>`;

  const lines = [row("Average order value", money(d.aov, cur), "")];
  if (d.refundRate > 0) {
    lines.push(row("Less refunds", "-" + money(c.refundLoss, cur), ""));
    lines.push(row("Net revenue", money(c.netAov, cur), "100.0%", "total"));
  }
  if (d.cogs > 0) {
    lines.push(row("Less product cost", "-" + money(d.cogs, cur), ""));
    lines.push(row("After product cost", money(c.cm1, cur), pct(c.cm1Pct), "total"));
  }
  if (d.shipping > 0) lines.push(row("Less shipping and fulfilment", "-" + money(d.shipping, cur), ""));
  if (c.feeAmount > 0) lines.push(row(`Less payment fees at ${d.paymentFees}%`, "-" + money(c.feeAmount, cur), ""));
  if (d.other > 0) lines.push(row("Less other variable costs", "-" + money(d.other, cur), ""));
  lines.push(row("After all variable costs", money(c.cm2, cur), pct(c.cm2Pct), hasCac ? "total" : "highlight"));
  if (hasCac) {
    lines.push(row("Less cost to acquire", "-" + money(d.cac, cur), ""));
    lines.push(row("Contribution margin", money(c.cm3, cur), pct(c.cm3Pct), "highlight"));
  }
  ladderEl.innerHTML = `<p class="section-label">Where the money goes</p><table><tbody>${lines.join("")}</tbody></table>`;

  breakevenEl.hidden = false;
  if (c.cm2 > 0) {
    const verdict = hasCac
      ? (d.cac < c.breakEvenCac
          ? `You are paying ${money(d.cac, cur)}, so you have ${money(c.breakEvenCac - d.cac, cur)} of headroom per order.`
          : `You are paying ${money(d.cac, cur)}, which is ${money(d.cac - c.breakEvenCac, cur)} more than an order can carry.`)
      : "Pay less than this and the first order already pays for itself.";
    breakevenEl.innerHTML = `
      <p class="section-label">What you can afford to pay for a customer</p>
      <table><tbody>
        ${row("Break-even acquisition cost", money(c.breakEvenCac, cur), "")}
        ${row("Break-even blended ROAS", c.breakEvenRoas.toFixed(2) + "x", "")}
      </tbody></table>
      <p class="hero-note">${verdict}</p>`;
  } else {
    breakevenEl.innerHTML = `
      <p class="section-label">What you can afford to pay for a customer</p>
      <p class="hero-note">Nothing. This order loses money before you have spent a penny on ads. Fix the product cost, the shipping, or the price before you buy any traffic.</p>`;
  }

  if (d.ordersPerMonth > 0) {
    const profitLine = d.fixedCosts > 0
      ? row("Profit after fixed costs", money(c.monthlyProfit, cur), "", "total")
      : "";
    const beLine = d.fixedCosts > 0 && c.cm3 > 0
      ? row("Orders needed to cover fixed costs", Math.ceil(c.breakEvenOrders).toLocaleString("en-US"), "")
      : "";
    monthlyEl.hidden = false;
    monthlyEl.innerHTML = `
      <p class="section-label">Across a month</p>
      <table><tbody>
        ${row(`Contribution from ${d.ordersPerMonth.toLocaleString("en-US")} orders`, money(c.monthlyContribution, cur), "")}
        ${d.fixedCosts > 0 ? row("Less fixed costs", "-" + money(d.fixedCosts, cur), "") : ""}
        ${profitLine}
        ${beLine}
      </tbody></table>`;
  } else {
    monthlyEl.hidden = true;
    monthlyEl.innerHTML = "";
  }

  footNoteEl.textContent = "Payment fees are worked out on net revenue. Refunds reduce revenue but product cost is kept in full, which assumes a returned item cannot be resold. That is the conservative reading.";
}

/* ---------- currency symbols ---------- */

function syncPrefixes() {
  const symbol = (form.elements.currency.value || "$").trim() || "$";
  document.querySelectorAll(".prefix").forEach(node => node.textContent = symbol);
}

/* ---------- filling ---------- */

function fillFields(data, label) {
  const entries = FIELD_KEYS.filter(key => key !== "currency" && data[key] !== undefined && data[key] !== "" && data[key] !== 0).map(key => [key, data[key]]);
  const token = ++fillToken;
  FIELD_KEYS.forEach(key => { if (key !== "currency") form.elements[key].value = ""; });
  if (data.currency) form.elements.currency.value = data.currency;
  syncPrefixes();

  const finish = () => { syncPrefixes(); render(); if (label) notify(label); };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    entries.forEach(([key, value]) => form.elements[key].value = value);
    return finish();
  }

  let index = 0;
  const step = () => {
    if (token !== fillToken) return;
    const [key, value] = entries[index];
    form.elements[key].value = value;
    render();
    index += 1;
    if (index < entries.length) {
      setTimeout(step, 26 + Math.random() * 48);
      return;
    }
    finish();
  };
  setTimeout(step, 40);
}

/* ---------- paste from AI ---------- */

const pasteDialog = document.querySelector("#pasteDialog");
const pasteInput = document.querySelector("#pasteInput");
const pasteError = document.querySelector("#pasteError");

function currentAsCode() {
  const d = getInputs();
  const shape = {};
  FIELD_KEYS.forEach(key => shape[key] = d[key]);
  return JSON.stringify(shape, null, 2);
}

function parsePasted(raw) {
  const text = String(raw || "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  if (!text) return null;
  const out = {};
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      Object.entries(parsed).forEach(([key, value]) => {
        const mapped = FIELD_ALIASES[String(key).toLowerCase().trim()] || String(key).trim();
        if (FIELD_KEYS.includes(mapped) && value !== null && value !== "") out[mapped] = value;
      });
      if (Object.keys(out).length) return out;
    } catch {}
  }
  text.split(/\n+/).forEach(line => {
    const match = line.match(/^\s*[-*"]?\s*([A-Za-z ]+?)"?\s*[:=]\s*"?([^",]+)"?,?\s*$/);
    if (!match) return;
    const mapped = FIELD_ALIASES[match[1].toLowerCase().trim()] || match[1].trim();
    if (FIELD_KEYS.includes(mapped)) out[mapped] = match[2].trim();
  });
  return Object.keys(out).length ? out : null;
}

document.querySelector("#openPaste").addEventListener("click", () => {
  pasteError.hidden = true;
  pasteInput.value = currentAsCode();
  pasteDialog.showModal();
  document.body.classList.add("dialog-open");
  pasteInput.focus();
  pasteInput.setSelectionRange(0, 0);
});

pasteDialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));

pasteDialog.addEventListener("click", event => {
  const box = pasteDialog.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) pasteDialog.close();
});

document.querySelector("#closePaste").addEventListener("click", () => pasteDialog.close());

// copy, with a fallback for browsers that block the clipboard
function copyText(text, done) {
  const fallback = () => {
    const tmp = document.createElement("textarea");
    tmp.value = text;
    tmp.style.position = "fixed";
    tmp.style.opacity = "0";
    (document.querySelector("dialog[open]") || document.body).append(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    tmp.remove();
    notify(ok ? done : "Your browser blocked copying. Try again in Chrome or Safari.");
  };
  try { navigator.clipboard.writeText(text).then(() => notify(done), fallback); } catch { fallback(); }
}

document.querySelector("#copyPrompt").addEventListener("click", () => copyText(AI_PROMPT, "AI instructions copied."));

document.querySelector("#applyPaste").addEventListener("click", () => {
  const data = parsePasted(pasteInput.value);
  if (!data) {
    pasteError.textContent = "Could not read that. Paste the JSON object your AI returned, or one field per line as name: value.";
    pasteError.hidden = false;
    return;
  }
  if (!data.aov) {
    pasteError.textContent = "Missing average order value. Nothing can be worked out without it.";
    pasteError.hidden = false;
    return;
  }
  pasteDialog.close();
  fillFields(data, "Filled from your AI. Check the figures.");
});

/* ---------- controls ---------- */

function resetAll() {
  FIELD_KEYS.forEach(key => { if (key !== "currency") form.elements[key].value = ""; });
  form.elements.currency.value = "$";
  syncPrefixes();
  render();
  notify("Everything erased.");
  window.scrollTo({ top: 0 });
}

// clearing asks for a second click, like the other Conversion Alchemy tools
let resetArmed = false, resetTimer;
document.querySelector("#resetAll").addEventListener("click", event => {
  const b = event.currentTarget;
  if (!resetArmed) {
    resetArmed = true;
    b.textContent = "Click Again To Erase Everything";
    b.classList.add("danger");
    resetTimer = setTimeout(() => { resetArmed = false; b.textContent = "Clear All Data"; b.classList.remove("danger"); }, 4000);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed = false;
  b.textContent = "Clear All Data";
  b.classList.remove("danger");
  resetAll();
});

document.querySelector("#saveAll").addEventListener("click", () => {
  if (resultsSection.hidden) return notify("Enter your figures first.");
  window.print();
});

form.addEventListener("input", () => { syncPrefixes(); render(); });
form.addEventListener("submit", event => event.preventDefault());

function notify(message) { toast.textContent = message; }

/* ---------- start ---------- */

FIELD_KEYS.forEach(key => form.elements[key].value = DEFAULTS[key]);
syncPrefixes();
render();
