// The money logic, with no DOM and no storage, so every rule is unit-tested in Node.
// Amounts are whole cents (integers) everywhere; only the screen and the Excel file
// show euros.

export const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

/* ---------- text ---------- */
// Lowercase without accents: "Alimentação" and "alimentacao" match.
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));

/* ---------- money ---------- */
export const toCents = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  let s = String(v ?? "").replace(/[€$£\s]/g, "");
  if (!s) return NaN;
  // "1.234,56" and "1,234.56" and "12,5" and "12.5"
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
};
export const formatMoney = (cents, locale = "pt-PT", currency = "EUR") =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format((cents || 0) / 100);

/* ---------- months ---------- */
export const monthOf = (date) => String(date).slice(0, 7);
export const addMonths = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
export const thisMonth = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
export const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const isDate = (d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);

/* ---------- entries ---------- */
// entry: { id, month, date|null, desc, cat (category id), amount (cents, what was paid),
//          account|null, split|null, note }
// split: { with: "Name", paidBy: "me"|"them", mine (cents, my share), settled: bool }
// What the entry costs me: my share when the bill was split.
export const myCost = (e) => (e.split ? e.split.mine : e.amount);

export function validEntry(e, categoryIds) {
  const errors = [];
  if (!fold(e.desc)) errors.push("desc");
  if (!Number.isInteger(e.amount) || e.amount === 0 || Math.abs(e.amount) > 1e11) errors.push("amount");
  if (!isMonth(e.month)) errors.push("month");
  if (e.date && (!isDate(e.date) || monthOf(e.date) !== e.month)) errors.push("date");
  if (!categoryIds.has(e.cat)) errors.push("cat");
  if (e.split) {
    if (!fold(e.split.with)) errors.push("splitWith");
    if (!Number.isInteger(e.split.mine) || e.split.mine < 0 || Math.abs(e.split.mine) > Math.abs(e.amount)) errors.push("splitMine");
    if (!["me", "them"].includes(e.split.paidBy)) errors.push("splitPaidBy");
  }
  if (String(e.desc).length > 200 || String(e.note ?? "").length > 2000) errors.push("length");
  return errors;
}

/* ---------- categories ---------- */
// category: { id, name, kind: "expense"|"saving", order, hidden }
// Savings and investments are tracked but left out of the month's spending total,
// exactly like the spreadsheet (its total sums only the expense rows).
export const DEFAULT_CATEGORIES = {
  en: [["Food", "expense"], ["Home", "expense"], ["Health", "expense"], ["Lodging", "expense"], ["Transport", "expense"], ["Entertainment", "expense"], ["Technology", "expense"], ["Clothes", "expense"], ["Beauty", "expense"], ["Services", "expense"], ["Culture", "expense"], ["Vices", "expense"], ["Other", "expense"], ["Savings", "saving"], ["Investment", "saving"]],
  pt: [["Alimentação", "expense"], ["Casa", "expense"], ["Saúde", "expense"], ["Alojamento", "expense"], ["Transporte", "expense"], ["Entretenimento", "expense"], ["Tecnologia", "expense"], ["Roupa", "expense"], ["Estética", "expense"], ["Serviços", "expense"], ["Cultura", "expense"], ["Vícios", "expense"], ["Outros", "expense"], ["Poupança", "saving"], ["Investimento", "saving"]],
};
export const defaultCategories = (lang) => (DEFAULT_CATEGORIES[lang] || DEFAULT_CATEGORIES.en).map(([name, kind], i) => ({ id: uid(), name, kind, order: i, hidden: false }));
export const sortCats = (cats) => [...cats].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
export const findCategory = (cats, name) => cats.find((c) => fold(c.name) === fold(name));

/* ---------- summaries ---------- */
export function monthSummary(entries, cats, month) {
  const rows = new Map(sortCats(cats).map((c) => [c.id, { cat: c, total: 0, count: 0, biggest: null }]));
  let spent = 0, saved = 0, count = 0;
  for (const e of entries) {
    if (e.month !== month) continue;
    const r = rows.get(e.cat); if (!r) continue;
    const v = myCost(e);
    r.total += v; r.count++; count++;
    if (!r.biggest || v > myCost(r.biggest)) r.biggest = e;
    if (r.cat.kind === "saving") saved += v; else spent += v;
  }
  return { month, rows: [...rows.values()], spent, saved, count };
}

// Spending per month (expense categories only), oldest first.
export function monthlyTotals(entries, cats, { cat = null } = {}) {
  const kind = new Map(cats.map((c) => [c.id, c.kind]));
  const m = new Map();
  for (const e of entries) {
    if (cat ? e.cat !== cat : kind.get(e.cat) !== "expense") continue;
    m.set(e.month, (m.get(e.month) || 0) + myCost(e));
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export const monthsWithData = (entries) => [...new Set(entries.map((e) => e.month))].sort();

/* ---------- the month's conclusion (drafted on the device, no AI service) ---------- */
// Compares the month with the average of up to 12 earlier months that have data.
// Short, plain, and the person can rewrite it; their own words are kept.
const T = {
  en: { calm: "A calm month", normal: "A normal month", heavy: "A heavy month", first: "First month on record",
        more: (l) => `more than usual on ${l}`, less: (l) => `less on ${l}`, big: (d, v) => `biggest: ${d} (${v})`, and: " and ", saved: (v) => `saved ${v}` },
  pt: { calm: "Mês calmo", normal: "Mês normal", heavy: "Mês pesado", first: "Primeiro mês registado",
        more: (l) => `mais do que o costume em ${l}`, less: (l) => `menos em ${l}`, big: (d, v) => `maior: ${d} (${v})`, and: " e ", saved: (v) => `poupança de ${v}` },
};
const list = (xs, and) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + and + xs.at(-1));

export function draftConclusion(entries, cats, month, { lang = "en", locale = "pt-PT", currency = "EUR" } = {}) {
  const t = T[lang] || T.en;
  const money = (c) => formatMoney(c, locale, currency);
  const now = monthSummary(entries, cats, month);
  if (!now.count) return "";
  const earlier = monthsWithData(entries).filter((m) => m < month).slice(-12);
  const parts = [];
  if (!earlier.length) parts.push(t.first);
  else {
    const past = earlier.map((m) => monthSummary(entries, cats, m));
    const avg = past.reduce((s, p) => s + p.spent, 0) / past.length;
    parts.push(now.spent < avg * 0.85 ? t.calm : now.spent > avg * 1.15 ? t.heavy : t.normal);
    const catAvg = (id) => past.reduce((s, p) => s + (p.rows.find((r) => r.cat.id === id)?.total || 0), 0) / past.length;
    const ups = [], downs = [];
    for (const r of now.rows) {
      if (r.cat.kind !== "expense") continue;
      const a = catAvg(r.cat.id), diff = r.total - a;
      if (diff > Math.max(a * 0.3, 3000)) ups.push([diff, r.cat.name.toLowerCase()]);
      else if (a > 5000 && r.total < a * 0.5) downs.push([a - r.total, r.cat.name.toLowerCase()]);
    }
    ups.sort((x, y) => y[0] - x[0]); downs.sort((x, y) => y[0] - x[0]);
    if (ups.length) parts.push(t.more(list(ups.slice(0, 2).map((u) => u[1]), t.and)));
    if (downs.length) parts.push(t.less(list(downs.slice(0, 1).map((d) => d[1]), t.and)));
  }
  const top = now.rows.filter((r) => r.cat.kind === "expense" && r.biggest).map((r) => r.biggest).sort((a, b) => myCost(b) - myCost(a))[0];
  if (top && now.spent > 0 && myCost(top) >= now.spent * 0.2) parts.push(t.big(top.desc, money(myCost(top))));
  if (now.saved > 0) parts.push(t.saved(money(now.saved)));
  return parts.join("; ") + ".";
}

/* ---------- category suggestions, learned from the person's own history ---------- */
export function buildSuggester(entries) {
  const exact = new Map(), first = new Map(), token = new Map();
  const bump = (map, key, cat, w = 1) => { if (!key) return; let m = map.get(key); if (!m) map.set(key, (m = new Map())); m.set(cat, (m.get(cat) || 0) + w); };
  // newer entries weigh a little more, so a renamed habit wins over time
  const sorted = [...entries].sort((a, b) => a.month.localeCompare(b.month));
  sorted.forEach((e, i) => {
    const w = 1 + i / Math.max(1, sorted.length);
    const ws = words(e.desc);
    bump(exact, fold(e.desc), e.cat, w); bump(first, ws[0], e.cat, w);
    for (const x of ws) bump(token, x, e.cat, w);
  });
  const best = (m) => { if (!m) return null; let top = null, sum = 0; for (const [c, n] of m) { sum += n; if (!top || n > top[1]) top = [c, n]; } return { cat: top[0], confidence: top[1] / sum }; };
  return {
    suggest(desc) {
      const f = fold(desc); if (!f) return null;
      const ex = best(exact.get(f)); if (ex) return { ...ex, how: "exact" };
      const ws = words(desc);
      const fi = best(first.get(ws[0])); if (fi && fi.confidence >= 0.6) return { ...fi, how: "first" };
      const votes = new Map();
      for (const x of ws) for (const [c, n] of token.get(x) || []) votes.set(c, (votes.get(c) || 0) + n);
      const v = best(votes.size ? votes : null);
      return v && v.confidence >= 0.5 ? { ...v, how: "words" } : null;
    },
    // Descriptions used before, most used first, for the autocomplete list.
    known(limit = 400) {
      const counts = new Map();
      for (const e of sorted) { const k = String(e.desc).trim(); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
    },
  };
}

/* ---------- search ---------- */
// q matches the description and note, without accents; filters narrow it down.
export function search(entries, { q = "", cat = "", from = "", to = "", min = null, max = null, shared = false, open = false } = {}) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const out = entries.filter((e) => {
    if (cat && e.cat !== cat) return false;
    if (from && e.month < from) return false;
    if (to && e.month > to) return false;
    const v = myCost(e);
    if (min !== null && v < min) return false;
    if (max !== null && v > max) return false;
    if (shared && !e.split) return false;
    if (open && !(e.split && !e.split.settled)) return false;
    if (terms.length) { const hay = fold(`${e.desc} ${e.note ?? ""} ${e.account ?? ""} ${e.split?.with ?? ""}`); if (!terms.every((t) => hay.includes(t))) return false; }
    return true;
  });
  out.sort((a, b) => (b.date || b.month).localeCompare(a.date || a.month) || myCost(b) - myCost(a));
  return { results: out, total: out.reduce((s, e) => s + myCost(e), 0) };
}

/* ---------- split bills ---------- */
// Positive: they owe me. Negative: I owe them. Settled bills don't count.
export function balances(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!e.split || e.split.settled) continue;
    const key = e.split.with.trim(); const name = [...m.keys()].find((k) => fold(k) === fold(key)) ?? key;
    const v = e.split.paidBy === "me" ? e.amount - e.split.mine : -e.split.mine;
    m.set(name, (m.get(name) || 0) + v);
  }
  return [...m.entries()].filter(([, v]) => v !== 0).map(([name, amount]) => ({ name, amount })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/* ---------- accounts: where each one was last brought up to date ---------- */
// account: { id, name, last: { desc, date, amount } | null } (the spreadsheet's "Updated" box)
export function accountProgress(accounts, entries) {
  return accounts.map((a) => {
    let latest = null;
    for (const e of entries) if (e.account === a.id && (!latest || (e.date || e.month) > (latest.date || latest.month))) latest = e;
    const fromEntries = latest ? { desc: latest.desc, date: latest.date || latest.month, amount: latest.amount } : null;
    const last = !a.last ? fromEntries : !fromEntries ? a.last : (fromEntries.date >= a.last.date ? fromEntries : a.last);
    return { ...a, last };
  });
}

/* ---------- goals ---------- */
// goal: { id, name, target (cents)|null, movements: [{ id, desc, date, amount }] }
export function goalStatus(g) {
  const current = g.movements.reduce((s, m) => s + m.amount, 0);
  return { current, missing: g.target ? Math.max(0, g.target - current) : null, progress: g.target ? Math.min(1, current / g.target) : null };
}

/* ---------- charts data ---------- */
export function yearTotals(entries, cats) {
  const m = new Map();
  for (const [month, v] of monthlyTotals(entries, cats)) m.set(month.slice(0, 4), (m.get(month.slice(0, 4)) || 0) + v);
  return [...m.entries()];
}
export function categoryTotals(entries, cats, { from = "", to = "" } = {}) {
  const t = new Map();
  for (const e of entries) { if ((from && e.month < from) || (to && e.month > to)) continue; t.set(e.cat, (t.get(e.cat) || 0) + myCost(e)); }
  return sortCats(cats).filter((c) => c.kind === "expense").map((c) => ({ cat: c, total: t.get(c.id) || 0 })).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
}

/* ---------- backup ---------- */
export const BACKUP_VERSION = 1;
export function checkBackup(b) {
  if (!b || b.app !== "expenses" || b.version !== BACKUP_VERSION) return "bad-backup";
  for (const k of ["entries", "categories", "accounts", "goals"]) if (!Array.isArray(b[k])) return "bad-backup";
  if (typeof b.conclusions !== "object" || b.conclusions === null) return "bad-backup";
  const ids = new Set(b.categories.map((c) => c.id));
  if (b.entries.some((e) => validEntry(e, ids).length)) return "bad-backup";
  return null;
}

