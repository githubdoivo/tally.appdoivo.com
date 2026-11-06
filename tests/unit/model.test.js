import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../../js/model.js";

const cats = [
  { id: "food", name: "Alimentação", kind: "expense", order: 0 },
  { id: "home", name: "Casa", kind: "expense", order: 1 },
  { id: "vice", name: "Vícios", kind: "expense", order: 2 },
  { id: "save", name: "Poupança", kind: "saving", order: 3 },
];
const e = (month, desc, cat, amount, extra = {}) => ({ id: M.uid(), month, date: null, desc, cat, amount, account: null, split: null, note: "", ...extra });

test("money: euros typed either way become exact cents", () => {
  assert.equal(M.toCents("12,5"), 1250);
  assert.equal(M.toCents("1.234,56"), 123456);
  assert.equal(M.toCents("1,234.56"), 123456);
  assert.equal(M.toCents("€ 3.10"), 310);
  assert.equal(M.toCents(0.1 + 0.2), 30);
  assert.ok(Number.isNaN(M.toCents("abc")));
  assert.ok(Number.isNaN(M.toCents("1e5")));
  assert.ok(Number.isNaN(M.toCents("")));
});

test("months: adding across years, and the shapes that are allowed", () => {
  assert.equal(M.addMonths("2026-01", -1), "2025-12");
  assert.equal(M.addMonths("2025-12", 1), "2026-01");
  assert.equal(M.addMonths("2026-03", -14), "2025-01");
  assert.ok(M.isMonth("2026-10") && !M.isMonth("2026-13") && !M.isMonth("26-10"));
  assert.ok(M.isDate("2026-02-28") && !M.isDate("2026-02-32"));
});

test("an entry is refused when anything is missing or out of range", () => {
  const ids = new Set(cats.map((c) => c.id));
  assert.deepEqual(M.validEntry(e("2026-10", "pão", "food", 120), ids), []);
  assert.ok(M.validEntry(e("2026-10", " ", "food", 120), ids).includes("desc"));
  assert.ok(M.validEntry(e("2026-10", "pão", "nope", 120), ids).includes("cat"));
  assert.ok(M.validEntry(e("2026-10", "pão", "food", 0), ids).includes("amount"));
  assert.ok(M.validEntry(e("2026-10", "pão", "food", 1.5), ids).includes("amount"));
  assert.ok(M.validEntry(e("2026-10", "pão", "food", 100, { date: "2026-11-01" }), ids).includes("date"));
  assert.ok(M.validEntry(e("2026-10", "x".repeat(201), "food", 100), ids).includes("length"));
  assert.ok(M.validEntry(e("2026-10", "jantar", "food", 100, { split: { with: "Ana", paidBy: "me", mine: 200, settled: false } }), ids).includes("splitMine"));
  assert.ok(M.validEntry(e("2026-10", "jantar", "food", 100, { split: { with: "", paidBy: "me", mine: 50, settled: false } }), ids).includes("splitWith"));
});

test("the month summary: totals per category, the biggest expense, savings kept apart", () => {
  const list = [e("2026-10", "mercado", "food", 3156), e("2026-10", "jantar", "food", 4000), e("2026-10", "renda", "home", 40000), e("2026-10", "mealheiro", "save", 5000), e("2026-09", "outro mês", "food", 999)];
  const s = M.monthSummary(list, cats, "2026-10");
  assert.equal(s.spent, 47156);
  assert.equal(s.saved, 5000);
  assert.equal(s.count, 4);
  const food = s.rows.find((r) => r.cat.id === "food");
  assert.equal(food.total, 7156);
  assert.equal(food.biggest.desc, "jantar");
  assert.equal(s.rows.find((r) => r.cat.id === "vice").biggest, null);
});

test("a split bill counts only my share", () => {
  const list = [e("2026-10", "jantar", "food", 6000, { split: { with: "Ana", paidBy: "me", mine: 3000, settled: false } })];
  assert.equal(M.monthSummary(list, cats, "2026-10").spent, 3000);
  assert.equal(M.monthlyTotals(list, cats)[0][1], 3000);
});

test("balances: who owes whom, settled bills ignored, names matched without accents", () => {
  const list = [
    e("2026-10", "jantar", "food", 6000, { split: { with: "Inês", paidBy: "me", mine: 3000, settled: false } }),
    e("2026-10", "uber", "food", 2000, { split: { with: "ines", paidBy: "them", mine: 1000, settled: false } }),
    e("2026-10", "cinema", "food", 1500, { split: { with: "Rui", paidBy: "them", mine: 750, settled: false } }),
    e("2026-10", "antigo", "food", 9000, { split: { with: "Rui", paidBy: "me", mine: 100, settled: true } }),
  ];
  assert.deepEqual(M.balances(list), [{ name: "Inês", amount: 2000 }, { name: "Rui", amount: -750 }]);
});

test("monthly totals leave savings out and come oldest first", () => {
  const list = [e("2026-10", "a", "food", 100), e("2026-09", "b", "home", 200), e("2026-10", "c", "save", 999)];
  assert.deepEqual(M.monthlyTotals(list, cats), [["2026-09", 200], ["2026-10", 100]]);
  assert.deepEqual(M.monthlyTotals(list, cats, { cat: "save" }), [["2026-10", 999]]);
});

test("the conclusion draft: calm, normal or heavy against the past year, in both languages", () => {
  const past = [];
  for (let i = 1; i <= 6; i++) past.push(e(M.addMonths("2026-10", -i), "renda", "home", 40000), e(M.addMonths("2026-10", -i), "mercado", "food", 20000), e(M.addMonths("2026-10", -i), "tabaco", "vice", 2000));
  const heavy = [...past, e("2026-10", "renda", "home", 40000), e("2026-10", "mercado", "food", 20000), e("2026-10", "tabaco", "vice", 30000)];
  const en = M.draftConclusion(heavy, cats, "2026-10", { lang: "en" });
  assert.match(en, /^A heavy month; more than usual on vícios/);
  const pt = M.draftConclusion(heavy, cats, "2026-10", { lang: "pt" });
  assert.match(pt, /^Mês pesado; mais do que o costume em vícios/);
  const normal = [...past, e("2026-10", "renda", "home", 40000), e("2026-10", "mercado", "food", 21000), e("2026-10", "tabaco", "vice", 2000)];
  assert.match(M.draftConclusion(normal, cats, "2026-10", { lang: "en" }), /^A normal month/);
  const calm = [...past, e("2026-10", "mercado", "food", 20000)];
  assert.match(M.draftConclusion(calm, cats, "2026-10", { lang: "en" }), /^A calm month; less on casa/);
  assert.match(M.draftConclusion([e("2026-10", "x", "food", 100)], cats, "2026-10", { lang: "en" }), /^First month on record/);
  assert.equal(M.draftConclusion([], cats, "2026-10"), "");
  assert.ok(M.draftConclusion(heavy, cats, "2026-10", { lang: "en" }).endsWith("."));
});

test("category suggestions learn from my own history", () => {
  const s = M.buildSuggester([e("2026-01", "Pingo Doce", "food", 1), e("2026-02", "pingo doce jantar", "food", 1), e("2026-02", "renda porto", "home", 1), e("2026-03", "Uber Eats ramen", "food", 1), e("2026-03", "tabaco", "vice", 1)]);
  assert.equal(s.suggest("pingo doce").cat, "food");
  assert.equal(s.suggest("PINGO DOCE").how, "exact");
  assert.equal(s.suggest("renda lisboa").cat, "home");
  assert.equal(s.suggest("ramen").cat, "food", "one word seen before is enough");
  assert.equal(s.suggest(""), null);
  assert.equal(s.suggest("algo novo"), null);
  assert.equal(s.known()[0], "Pingo Doce");
});

test("search: words without accents, filters, newest first, total of what was found", () => {
  const list = [e("2026-10", "Farmácia gastro", "food", 699, { date: "2026-10-03" }), e("2026-09", "farmacia", "home", 1500), e("2026-10", "jantar", "food", 4000, { split: { with: "Ana", paidBy: "me", mine: 2000, settled: false } })];
  assert.equal(M.search(list, { q: "FARMACIA" }).results.length, 2);
  assert.equal(M.search(list, { q: "farmacia gastro" }).results.length, 1);
  assert.equal(M.search(list, { cat: "home" }).total, 1500);
  assert.equal(M.search(list, { from: "2026-10" }).results.length, 2);
  assert.equal(M.search(list, { min: 1000 }).results.length, 2);
  assert.equal(M.search(list, { shared: true }).total, 2000);
  assert.equal(M.search(list, { q: "ana" }).results.length, 1);
  assert.equal(M.search(list, { open: true }).results.length, 1);
  assert.equal(M.search(list, {}).results[0].month, "2026-10");
});

test("accounts: where each was last brought up to date, from the import or newer entries", () => {
  const acc = [{ id: "a", name: "Banco", last: { desc: "velho", date: "2026-01-02", amount: 1 } }, { id: "b", name: "Outro", last: null }];
  const list = [e("2026-02", "novo", "food", 500, { account: "a", date: "2026-02-10" })];
  const p = M.accountProgress(acc, list);
  assert.equal(p[0].last.desc, "novo");
  assert.equal(p[1].last, null);
  assert.equal(M.accountProgress(acc, [])[0].last.desc, "velho");
});

test("goals: current value, what is missing and progress", () => {
  const g = { id: "g", name: "Férias", target: 100000, movements: [{ amount: 30000 }, { amount: 20000 }, { amount: -5000 }] };
  assert.deepEqual(M.goalStatus(g), { current: 45000, missing: 55000, progress: 0.45 });
  assert.deepEqual(M.goalStatus({ ...g, target: null }), { current: 45000, missing: null, progress: null });
});

test("charts data: per year and per category, savings left out", () => {
  const list = [e("2025-12", "a", "food", 100), e("2026-01", "b", "home", 300), e("2026-02", "c", "food", 50), e("2026-02", "d", "save", 9999)];
  assert.deepEqual(M.yearTotals(list, cats), [["2025", 100], ["2026", 350]]);
  assert.deepEqual(M.categoryTotals(list, cats).map((r) => [r.cat.id, r.total]), [["home", 300], ["food", 150]]);
  assert.deepEqual(M.categoryTotals(list, cats, { from: "2026-02" }).map((r) => r.cat.id), ["food"]);
});

test("default categories exist in both languages, savings marked apart", () => {
  for (const lang of ["en", "pt"]) {
    const d = M.defaultCategories(lang);
    assert.equal(d.length, 15);
    assert.equal(d.filter((c) => c.kind === "saving").length, 2);
    assert.equal(new Set(d.map((c) => c.id)).size, 15);
  }
});

test("backups are checked before they replace anything", () => {
  const good = { app: "expenses", version: 1, entries: [e("2026-10", "a", "food", 1)], categories: cats, accounts: [], goals: [], conclusions: {} };
  assert.equal(M.checkBackup(good), null);
  assert.equal(M.checkBackup({ ...good, app: "other" }), "bad-backup");
  assert.equal(M.checkBackup({ ...good, entries: [e("2026-10", "a", "missing", 1)] }), "bad-backup");
  assert.equal(M.checkBackup({ ...good, conclusions: null }), "bad-backup");
  assert.equal(M.checkBackup(null), "bad-backup");
});

