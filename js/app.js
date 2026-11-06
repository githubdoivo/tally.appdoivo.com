// Expenses: the screens. Data lives in IndexedDB on this device (db.js); the money
// rules are in model.js; Excel in excel.js (loaded only when used).
// Safety: every piece of user text reaches the page through textContent or
// element properties, never innerHTML.
import * as M from "./model.js";
import * as db from "./db.js";
import { WORDS, MONTH_NAMES, SHORT_MONTHS } from "./words.js";
import { columns, hbars } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if ((k === "value" && n.tagName === "TEXTAREA") || (k in n && typeof v !== "string")) n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
}

const S = {
  entries: [], categories: [], accounts: [], goals: [], conclusions: {}, notes: {},
  settings: { lang: "en", currency: "EUR", theme: "" },
  view: "month", month: M.thisMonth(), range: "12", searchShown: 200,
};
let suggester = M.buildSuggester([]);

/* ---------- words & formats ---------- */
const t = (k, ...a) => { const v = WORDS[S.settings.lang]?.[k] ?? WORDS.en[k]; return typeof v === "function" ? v(...a) : v ?? k; };
const locale = () => (S.settings.lang === "pt" ? "pt-PT" : "en-GB");
const money = (c) => M.formatMoney(c, locale(), S.settings.currency);
const shortMoney = (c) => new Intl.NumberFormat(locale(), { style: "currency", currency: S.settings.currency, notation: "compact", maximumFractionDigits: 1 }).format(c / 100);
const monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return `${MONTH_NAMES[S.settings.lang][mo - 1]} ${y}`; };
const dateLabel = (e) => { if (!e.date) return monthLabel(e.month); const [, mo, d] = e.date.split("-").map(Number); return `${d} ${SHORT_MONTHS[S.settings.lang][mo - 1]}`; };
const catById = () => new Map(S.categories.map((c) => [c.id, c]));
const visibleCats = () => M.sortCats(S.categories).filter((c) => !c.hidden);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function applyWords() {
  document.documentElement.lang = S.settings.lang === "pt" ? "pt-PT" : "en";
  document.title = `${t("brand")} · ${t("tagline")}`;
  for (const n of $$("[data-w]")) n.textContent = t(n.dataset.w);
  for (const n of $$("[data-w-label]")) { n.setAttribute("aria-label", t(n.dataset.wLabel)); n.title = t(n.dataset.wLabel); }
  for (const n of $$("[data-w-placeholder]")) n.placeholder = t(n.dataset.wPlaceholder);
  $('[data-range="12"]').textContent = t("lastMonths", 12);
}
function applyTheme() {
  const th = S.settings.theme;
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("theme", th); } catch { /* private mode */ }
}
const effectiveTheme = () => S.settings.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/* ---------- saving ---------- */
const saveKV = (key) => db.setKV(key, S[key]).catch(storageFailed);
const saveSettings = () => db.setKV("settings", S.settings).catch(storageFailed);
function storageFailed(err) { console.error(err); toast(S.settings.lang === "pt" ? "Não foi possível guardar neste dispositivo." : "Could not save on this device."); }
const rebuildSuggester = () => { suggester = M.buildSuggester(S.entries); fillDatalists(); };
function fillDatalists() {
  $("#known-descs").replaceChildren(...suggester.known(300).map((d) => h("option", { value: d })));
  const people = [...new Set(S.entries.filter((e) => e.split).map((e) => e.split.with.trim()))].sort();
  $("#known-people").replaceChildren(...people.map((p) => h("option", { value: p })));
}

/* ---------- toast & confirm ---------- */
let toastTimer;
function toast(msg, action) {
  const box = $("#toast"), btn = box.querySelector("button");
  box.querySelector("span").textContent = msg;
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = () => { box.hidden = true; action.run(); }; }
  box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, action ? 7000 : 3500);
}
function confirmBox(text, { typed = null, yes = "OK" } = {}) {
  const d = $("#confirm"), field = d.querySelector("[data-type]"), input = field.querySelector("input");
  $("#confirm-text").textContent = text; $("#confirm-yes").textContent = yes;
  field.hidden = !typed; input.value = "";
  if (typed) $("#confirm-type-label").textContent = t("wipeType");
  return new Promise((resolve) => {
    d.addEventListener("close", () => resolve(d.returnValue === "yes" && (!typed || input.value.trim().toUpperCase() === typed)), { once: true });
    d.returnValue = ""; d.showModal(); (typed ? input : $("#confirm-yes")).focus();
  });
}

/* ---------- routing ---------- */
const VIEWS = ["month", "search", "charts", "shared", "goals", "settings"];
function route() {
  const [v, m] = location.hash.replace(/^#/, "").split("/");
  S.view = VIEWS.includes(v) ? v : "month";
  if (S.view === "month" && m && M.isMonth(m)) S.month = m > M.thisMonth() ? M.thisMonth() : m;
  for (const x of VIEWS) $(`#v-${x}`).hidden = x !== S.view;
  for (const b of $$(".nav button")) { if (b.dataset.view === S.view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
  render();
}
const go = (view, month) => { const hash = `#${view}${month ? "/" + month : ""}`; if (location.hash === hash) route(); else location.hash = hash; };
function render() { ({ month: renderMonth, search: renderSearch, charts: renderCharts, shared: renderShared, goals: renderGoals, settings: renderSettings })[S.view](); }

/* ---------- forms: shared bits ---------- */
function fillCatSelect(sel, value, { all = false } = {}) {
  const opts = [h("option", { value: "", text: all ? t("allCategories") : "—" })];
  for (const c of all ? M.sortCats(S.categories) : visibleCats()) opts.push(h("option", { value: c.id, text: c.name }));
  if (value && !all && !visibleCats().some((c) => c.id === value)) { const c = catById().get(value); if (c) opts.push(h("option", { value: c.id, text: c.name })); }
  sel.replaceChildren(...opts); sel.value = value || "";
}
function fillAccountSelect(sel, value) {
  sel.replaceChildren(h("option", { value: "", text: t("noAccount") }), ...S.accounts.map((a) => h("option", { value: a.id, text: a.name })));
  sel.value = value || "";
}
// Reads an entry out of a form; returns { entry, errors: [[fieldName, message]] }.
function readEntryForm(f, base) {
  const errors = [];
  const amount = M.toCents(f.amount.value), date = f.date.value || null;
  const month = date ? M.monthOf(date) : base.month;
  const e = { ...base, desc: f.desc.value.trim(), cat: f.cat.value, amount, date, month, account: f.account.value || null, note: f.note ? f.note.value.trim() : base.note || "" };
  const splitOn = f.isSplit ? f.isSplit.checked : (f.splitWith.value.trim() !== "" || f.mine.value.trim() !== "");
  if (splitOn) {
    const mine = f.mine.value.trim() ? M.toCents(f.mine.value) : Math.round(amount / 2);
    e.split = { with: f.splitWith.value.trim(), paidBy: f.paidBy.value, mine, settled: f.settled ? f.settled.checked : false };
  } else e.split = null;
  const ids = new Set(S.categories.map((c) => c.id));
  const bad = M.validEntry(e, ids);
  if (bad.includes("desc") || bad.includes("length")) errors.push(["desc", t("errDesc")]);
  if (bad.includes("amount")) errors.push(["amount", t("errAmount")]);
  if (bad.includes("cat")) errors.push(["cat", t("errCat")]);
  if (bad.includes("date") || bad.includes("month")) errors.push(["date", t("errDate")]);
  if (bad.some((b) => b.startsWith("split"))) errors.push([bad.includes("splitWith") ? "splitWith" : "mine", t("errSplit")]);
  return { entry: e, errors };
}
function showErrors(f, errors, box) {
  for (const el of f.elements) el.removeAttribute?.("aria-invalid");
  for (const [name] of errors) f[name]?.setAttribute("aria-invalid", "true");
  box.textContent = errors.map((x) => x[1]).join(" ");
  if (errors.length) f[errors[0][0]]?.focus();
}

/* ---------- month ---------- */
function renderMonth() {
  const m = S.month, cats = catById();
  $("#month-title").textContent = monthLabel(m); $("#today").hidden = m === M.thisMonth();   // only when away from this month
  $("#today").hidden = m === M.thisMonth();
  $("#next").disabled = m >= M.thisMonth();
  const sum = M.monthSummary(S.entries, S.categories, m);
  $("#st-spent").textContent = money(sum.spent); $("#st-saved").textContent = money(sum.saved); $("#st-count").textContent = String(sum.count);

  const f = $("#add-form");
  fillCatSelect(f.cat, f.cat.value); fillAccountSelect(f.account, f.account.value);
  const firstDay = `${m}-01`, last = new Date(Date.UTC(...m.split("-").map(Number), 0)).getUTCDate();
  f.date.min = firstDay; f.date.max = `${m}-${String(last).padStart(2, "0")}`;
  if (!f.date.value || M.monthOf(f.date.value) !== m) f.date.value = m === M.thisMonth() ? todayISO() : "";

  const list = S.entries.filter((e) => e.month === m).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0));
  $("#entries tbody").replaceChildren(...list.map((e) => entryRow(e, cats)));
  $("#entries-empty").hidden = list.length > 0;

  $("#summary tbody").replaceChildren(...sum.rows.filter((r) => !r.cat.hidden || r.total).map((r) => h("tr", { class: `${r.cat.kind === "saving" ? "saving" : ""} ${r.total ? "" : "zero"}` },
    h("th", { scope: "row" }, r.cat.name, r.biggest ? h("span", { class: "big", text: `${t("biggest")}: ${r.biggest.desc} · ${money(M.myCost(r.biggest))}` }) : null),
    h("td", { class: "num", text: money(r.total) }))));
  $("#sum-total").textContent = money(sum.spent);

  renderConclusion(m, sum);
  const prog = M.accountProgress(S.accounts, S.entries);
  $("#left-card").hidden = !prog.length;
  $("#left-off").replaceChildren(...prog.map((a) => h("li", {}, h("strong", { text: a.name }),
    h("span", { text: a.last ? t("lastEntered", a.last.desc, money(a.last.amount), a.last.date.length === 7 ? monthLabel(a.last.date) : new Date(a.last.date + "T12:00:00").toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })) : t("nothingYet") }))));
}
function renderConclusion(m, sum) {
  const done = S.conclusions[m] || "", ended = m < M.thisMonth();
  const notes = $("#notes"); if (document.activeElement !== notes) notes.value = S.notes[m] || "";
  notes.readOnly = !!done; $("#notes-hint").textContent = done ? t("notesLocked") : "";
  const nextStart = new Date(`${M.addMonths(m, 1)}-01T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "long" });
  $("#conclusion").textContent = done || (!ended ? t("conclusionWait", nextStart) : sum.count ? "" : t("conclusionNone"));
  $("#conclusion").classList.toggle("pending", !done);
  $("#draft").hidden = !!done || !ended || !sum.count;
}
function entryRow(e, cats, { showMonth = false } = {}) {
  const c = cats.get(e.cat);
  return h("tr", { onclick: (ev) => { if (!ev.target.closest("button")) openEdit(e.id); } },
    h("td", {}, h("button", { type: "button", class: "row-btn", onclick: () => openEdit(e.id), text: e.desc }),
      e.split ? h("span", { class: `tag ${e.split.settled ? "" : "open"}`, text: `÷ ${e.split.with}` }) : null,
      showMonth ? h("span", { class: "sub", text: dateLabel(e) }) : null),
    h("td", { class: "c-cat", text: c ? c.name : "—" }),
    h("td", { class: "c-date", text: showMonth ? (e.date ? e.date : monthLabel(e.month)) : (e.date ? dateLabel(e) : "—") }),
    h("td", { class: "num" }, money(M.myCost(e)), e.split ? h("span", { class: "sub", text: money(e.amount) }) : null));
}
function setupMonth() {
  const f = $("#add-form"), hint = $("#add-suggest");
  $("#prev").onclick = () => go("month", M.addMonths(S.month, -1));
  $("#next").onclick = () => { const n = M.addMonths(S.month, 1); if (n <= M.thisMonth()) go("month", n); };
  $("#today").onclick = () => go("month", M.thisMonth());
  f.cat.addEventListener("change", () => { f.cat.dataset.touched = "1"; hint.textContent = ""; });
  f.desc.addEventListener("input", () => {
    if (f.cat.dataset.touched) return;
    const s = suggester.suggest(f.desc.value), c = s && catById().get(s.cat);
    if (c && !c.hidden) { f.cat.value = c.id; hint.textContent = t("suggested", c.name); } else hint.textContent = "";
  });
  f.querySelector("[data-half]").onclick = () => { const a = M.toCents(f.amount.value); if (Number.isFinite(a)) f.mine.value = (Math.round(a / 2) / 100).toFixed(2).replace(".", S.settings.lang === "pt" ? "," : "."); };
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { entry, errors } = readEntryForm(f, { id: M.uid(), month: S.month, note: "", created: Date.now() });
    showErrors(f, errors, $("#add-error"));
    if (errors.length) return;
    S.entries.push(entry);
    try { await db.putEntries([entry]); } catch (err) { S.entries.pop(); storageFailed(err); return; }
    const keepDate = f.date.value, keepAcc = f.account.value;
    f.reset(); f.date.value = keepDate; f.account.value = keepAcc; delete f.cat.dataset.touched; hint.textContent = "";
    f.querySelector(".split-box").open = false;
    rebuildSuggester(); renderMonth(); f.desc.focus();
    toast(t("savedMsg"));
  });
  // Month notes: written during the month, editable until the conclusion is made.
  let timer;
  $("#notes").addEventListener("input", (ev) => {
    clearTimeout(timer);
    timer = setTimeout(async () => { const v = ev.target.value.trim(); if (S.conclusions[S.month]) return; if (v) S.notes[S.month] = v.slice(0, 2000); else delete S.notes[S.month]; await saveKV("notes"); $("#notes-hint").textContent = t("notesSaved"); }, 500);
  });
  // The conclusion: made once the month has ended, from the numbers and the notes; not editable.
  $("#draft").onclick = async () => {
    const m = S.month; if (m >= M.thisMonth() || S.conclusions[m]) return;
    const d = M.draftConclusion(S.entries, S.categories, m, { lang: S.settings.lang, locale: locale(), currency: S.settings.currency });
    if (!d) return;
    if (!(await confirmBox(t("conclusionSure"), { yes: t("draft") }))) return;
    const notes = (S.notes[m] || "").trim();
    S.conclusions[m] = notes ? `${d}\n\n${t("notesLabel")}: ${notes}` : d;
    await saveKV("conclusions"); renderMonth();
  };
}

/* ---------- edit dialog ---------- */
function openEdit(id) {
  const e = S.entries.find((x) => x.id === id); if (!e) return;
  const d = $("#edit"), f = $("#edit-form");
  f.dataset.id = id;
  f.desc.value = e.desc; fillCatSelect(f.cat, e.cat); f.amount.value = (e.amount / 100).toFixed(2).replace(".", S.settings.lang === "pt" ? "," : ".");
  f.date.value = e.date || ""; f.date.min = `${e.month}-01`; f.date.max = `${e.month}-31`;
  fillAccountSelect(f.account, e.account); f.note.value = e.note || "";
  f.isSplit.checked = !!e.split; f.querySelector("[data-split]").hidden = !e.split;
  f.splitWith.value = e.split?.with || ""; f.paidBy.value = e.split?.paidBy || "me";
  f.mine.value = e.split ? (e.split.mine / 100).toFixed(2).replace(".", S.settings.lang === "pt" ? "," : ".") : ""; f.settled.checked = !!e.split?.settled;
  showErrors(f, [], f.querySelector(".error"));
  d.showModal(); f.desc.focus();
}
function setupEdit() {
  const d = $("#edit"), f = $("#edit-form");
  f.isSplit.addEventListener("change", () => { f.querySelector("[data-split]").hidden = !f.isSplit.checked; });
  f.querySelector("[data-cancel]").onclick = () => d.close();
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const i = S.entries.findIndex((x) => x.id === f.dataset.id); if (i < 0) return d.close();
    const old = S.entries[i];
    const { entry, errors } = readEntryForm(f, old);
    showErrors(f, errors, f.querySelector(".error"));
    if (errors.length) return;
    S.entries[i] = entry;
    try { await db.putEntries([entry]); } catch (err) { S.entries[i] = old; storageFailed(err); return; }
    d.close(); rebuildSuggester(); render(); toast(t("savedMsg"));
  });
  f.querySelector("[data-delete]").onclick = async () => {
    const i = S.entries.findIndex((x) => x.id === f.dataset.id); if (i < 0) return d.close();
    const [gone] = S.entries.splice(i, 1);
    try { await db.deleteEntries([gone.id]); } catch (err) { S.entries.splice(i, 0, gone); storageFailed(err); return; }
    d.close(); rebuildSuggester(); render();
    toast(t("deleted"), { label: t("undo"), run: async () => { S.entries.push(gone); await db.putEntries([gone]); rebuildSuggester(); render(); } });
  };
}

/* ---------- search ---------- */
function searchQuery() {
  const f = $("#search-form");
  const num = (v) => { const c = M.toCents(v); return Number.isFinite(c) ? c : null; };
  return { q: f.q.value, cat: f.cat.value, from: f.from.value, to: f.to.value, min: f.min.value.trim() ? num(f.min.value) : null, max: f.max.value.trim() ? num(f.max.value) : null, shared: f.shared.checked, open: f.open.checked };
}
function renderSearch() {
  const f = $("#search-form");
  if (f.cat.options.length !== S.categories.length + 1) fillCatSelect(f.cat, f.cat.value, { all: true });
  const { results, total } = M.search(S.entries, searchQuery());
  $("#found").textContent = t("found", results.length, money(total));
  const cats = catById();
  $("#results tbody").replaceChildren(...results.slice(0, S.searchShown).map((e) => entryRow(e, cats, { showMonth: true })));
  const more = $("#more"); more.hidden = results.length <= S.searchShown;
  more.textContent = S.settings.lang === "pt" ? `Mostrar Mais (${results.length - S.searchShown})` : `Show More (${results.length - S.searchShown})`;
}
function setupSearch() {
  const f = $("#search-form"); let timer;
  f.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { S.searchShown = 200; renderSearch(); }, 120); });
  f.addEventListener("submit", (ev) => ev.preventDefault());
  f.addEventListener("reset", () => setTimeout(() => { S.searchShown = 200; renderSearch(); }));
  $("#more").onclick = () => { S.searchShown += 200; renderSearch(); };
}

/* ---------- charts ---------- */
function renderCharts() {
  for (const b of $$("#range button")) b.setAttribute("aria-checked", String(b.dataset.range === S.range));
  const now = M.thisMonth(), months = M.monthsWithData(S.entries);
  let from = months[0] || now, to = now;
  if (S.range === "12") from = M.addMonths(now, -11);
  if (S.range === "year") from = `${now.slice(0, 4)}-01`;
  if (months.length && months.at(-1) > to) to = months.at(-1);
  const totals = new Map(M.monthlyTotals(S.entries, S.categories));
  const data = [];
  for (let m = from, guard = 0; m <= to && guard < 1200; m = M.addMonths(m, 1), guard++) {
    const [y, mo] = m.split("-").map(Number);
    data.push({ label: mo === 1 || m === from ? `${SHORT_MONTHS[S.settings.lang][mo - 1]} ${String(y).slice(2)}` : SHORT_MONTHS[S.settings.lang][mo - 1], title: monthLabel(m), value: totals.get(m) || 0 });
  }
  columns($("#ch-month"), data, { format: money, short: shortMoney, tableHeads: [t("month"), t("spent")], tableLabel: t("byMonth") });
  hbars($("#ch-cat"), M.categoryTotals(S.entries, S.categories, { from, to }).map((r) => ({ label: r.cat.name, value: r.total })), { format: money, tableLabel: t("byCategory"), empty: t("nothingSpent") });
  columns($("#ch-year"), M.yearTotals(S.entries, S.categories).map(([y, v]) => ({ label: y, value: v })), { format: money, short: shortMoney, tableHeads: [t("year"), t("spent")], tableLabel: t("byYear") });
  for (const b of $$("[data-table]")) { const tab = $(`#${b.dataset.table} .chart-table`); b.textContent = tab && !tab.hidden ? t("hideTable") : t("showTable"); b.setAttribute("aria-expanded", String(!!tab && !tab.hidden)); }
}
function setupCharts() {
  for (const b of $$("#range button")) b.onclick = () => { S.range = b.dataset.range; renderCharts(); };
  for (const b of $$("[data-table]")) b.onclick = () => { const tab = $(`#${b.dataset.table} .chart-table`); if (tab) { tab.hidden = !tab.hidden; b.textContent = tab.hidden ? t("showTable") : t("hideTable"); b.setAttribute("aria-expanded", String(!tab.hidden)); } };
}

/* ---------- split bills ---------- */
function renderShared() {
  const bal = M.balances(S.entries);
  $("#balances").replaceChildren(...(bal.length ? bal.map((b) => h("li", { class: b.amount > 0 ? "pos" : "neg", text: b.amount > 0 ? t("owesYou", b.name, money(b.amount)) : t("youOwe", b.name, money(-b.amount)) })) : [h("li", { class: "none", text: t("allSettled") })]));
  const open = S.entries.filter((e) => e.split && !e.split.settled).sort((a, b) => (b.date || b.month).localeCompare(a.date || a.month));
  $("#open-bills").replaceChildren(...open.map((e) => h("li", {},
    h("div", {}, h("button", { type: "button", class: "row-btn", onclick: () => openEdit(e.id) }, h("strong", { text: e.desc })),
      h("span", { class: "sub", text: `${e.split.with} · ${dateLabel(e)} · ${money(e.amount)} (${t("myShare").toLowerCase()} ${money(e.split.mine)})` })),
    h("button", { type: "button", class: "ghost small", text: t("markSettled"), onclick: async () => { e.split = { ...e.split, settled: true }; await db.putEntries([e]); renderShared(); toast(t("savedMsg")); } }))));
  $("#open-bills").closest(".card").hidden = !open.length;
}

/* ---------- goals ---------- */
function renderGoals() {
  const host = $("#goals");
  if (!S.goals.length) { host.replaceChildren(h("p", { class: "note", text: t("noGoals") })); return; }
  host.replaceChildren(...S.goals.map((g) => {
    const st = M.goalStatus(g);
    const form = h("form", { class: "add-row", novalidate: true, autocomplete: "off" },
      h("label", { class: "f f-desc" }, h("span", { text: t("movement") }), h("input", { name: "desc", maxlength: "200", required: true })),
      h("label", { class: "f f-amount" }, h("span", { text: t("amount") }), h("input", { name: "amount", inputmode: "decimal", required: true })),
      h("label", { class: "f f-date" }, h("span", { text: t("date") }), h("input", { name: "date", type: "date", value: todayISO() })),
      h("button", { type: "submit", class: "primary", text: t("addMovement") }));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const amount = M.toCents(form.amount.value), desc = form.desc.value.trim();
      form.amount.toggleAttribute("aria-invalid", !Number.isFinite(amount) || amount === 0);
      form.desc.toggleAttribute("aria-invalid", !desc);
      if (!desc || !Number.isFinite(amount) || amount === 0) return;
      g.movements.push({ id: M.uid(), desc: desc.slice(0, 200), date: M.isDate(form.date.value) ? form.date.value : null, amount });
      await saveKV("goals"); renderGoals();
    });
    return h("section", { class: "card goal", "aria-label": g.name },
      h("div", { class: "goal-head" }, h("h2", { class: "card-title", text: g.name }),
        h("button", { type: "button", class: "ghost small", text: t("deleteGoal"), onclick: async () => { if (await confirmBox(`${t("deleteGoal")}: ${g.name}?`)) { S.goals = S.goals.filter((x) => x !== g); await saveKV("goals"); renderGoals(); } } })),
      h("div", { class: "goal-nums" }, h("span", {}, `${t("current")}: `, h("b", { text: money(st.current) })),
        g.target ? h("span", {}, `${t("target")}: `, h("b", { text: money(g.target) })) : null,
        g.target ? h("span", {}, `${t("missing")}: `, h("b", { text: money(st.missing) })) : null),
      g.target ? h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(st.progress * 100)), "aria-label": g.name }, (() => { const bar = h("span"); bar.style.width = `${Math.round(st.progress * 100)}%`; return bar; })()) : null,
      g.movements.length ? h("ul", { class: "moves" }, ...[...g.movements].reverse().map((mv) => h("li", {}, h("span", { text: `${mv.desc}${mv.date ? " · " + mv.date : ""}` }), h("span", { text: money(mv.amount) })))) : null,
      form);
  }));
}
function setupGoals() {
  const f = $("#goal-form");
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = f.name.value.trim(), target = f.target.value.trim() ? M.toCents(f.target.value) : null;
    const bad = !name ? t("errDesc") : target !== null && (!Number.isFinite(target) || target <= 0) ? t("errAmount") : "";
    f.querySelector(".error").textContent = bad;
    if (bad) return;
    S.goals.push({ id: M.uid(), name: name.slice(0, 60), target, movements: [] });
    await saveKV("goals"); f.reset(); renderGoals();
  });
}

/* ---------- settings ---------- */
function renderSettings() {
  const counts = new Map(); for (const e of S.entries) counts.set(e.cat, (counts.get(e.cat) || 0) + 1);
  const cats = M.sortCats(S.categories);
  $("#cat-list").replaceChildren(...cats.map((c, i) => {
    const name = h("input", { type: "text", value: c.name, maxlength: "40", "aria-label": t("categoryName") });
    name.addEventListener("change", async () => { const v = name.value.trim(); if (!v || S.categories.some((x) => x !== c && M.fold(x.name) === M.fold(v))) { name.value = c.name; return; } c.name = v; await saveKV("categories"); toast(t("savedMsg")); });
    const kind = h("select", { "aria-label": `${t("kind")}: ${c.name}` }, h("option", { value: "expense", text: t("kindExpense") }), h("option", { value: "saving", text: t("kindSaving") }));
    kind.value = c.kind; kind.addEventListener("change", async () => { c.kind = kind.value; await saveKV("categories"); });
    const merge = h("select", { "aria-label": `${t("mergeInto")} ${c.name}` }, h("option", { value: "", text: t("mergeInto") }), ...cats.filter((x) => x !== c).map((x) => h("option", { value: x.id, text: x.name })));
    merge.addEventListener("change", async () => {
      const into = S.categories.find((x) => x.id === merge.value); if (!into) return;
      if (!(await confirmBox(`${t("merge")}: ${c.name} → ${into.name}?`, { yes: t("merge") }))) { merge.value = ""; return; }
      const moved = S.entries.filter((e) => e.cat === c.id); for (const e of moved) e.cat = into.id;
      S.categories = S.categories.filter((x) => x !== c);
      await db.putEntries(moved); await saveKV("categories"); rebuildSuggester(); renderSettings(); toast(t("savedMsg"));
    });
    const move = (d) => async () => { const other = cats[i + d]; if (!other) return; [c.order, other.order] = [other.order, c.order]; if (c.order === other.order) c.order += d; await saveKV("categories"); renderSettings(); $$("#cat-list li")[i + d]?.querySelector(d < 0 ? "[data-up]" : "[data-down]")?.focus(); };
    // One tidy row: name, entry count, order arrows; the rarer actions sit under More
    const more = h("details", { class: "more", ontoggle: (e) => { e.target.querySelector("summary").textContent = e.target.open ? t("less") : t("more"); } }, h("summary", { text: t("more") }),
      h("div", { class: "more-body" }, kind, merge,
        h("button", { type: "button", class: "ghost small", text: c.hidden ? t("show") : t("hide"), onclick: async () => { c.hidden = !c.hidden; await saveKV("categories"); renderSettings(); } }),
        counts.get(c.id) ? null : h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: async () => { S.categories = S.categories.filter((x) => x !== c); await saveKV("categories"); renderSettings(); } })));
    return h("li", { class: c.hidden ? "muted" : "" }, name,
      h("span", { class: "count", text: t("nEntries", counts.get(c.id) || 0) }),
      h("button", { type: "button", class: "icon-btn", "data-up": true, "aria-label": `${t("moveUp")}: ${c.name}`, disabled: i === 0, onclick: move(-1), text: "↑" }),
      h("button", { type: "button", class: "icon-btn", "data-down": true, "aria-label": `${t("moveDown")}: ${c.name}`, disabled: i === cats.length - 1, onclick: move(1), text: "↓" }),
      more);
  }));
  $("#acc-list").replaceChildren(...S.accounts.map((a) => {
    const name = h("input", { type: "text", value: a.name, maxlength: "60", "aria-label": t("accountName") });
    name.addEventListener("change", async () => { const v = name.value.trim(); if (!v) { name.value = a.name; return; } a.name = v; await saveKV("accounts"); });
    return h("li", {}, name, h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: async () => {
      if (!(await confirmBox(`${t("delete")}: ${a.name}?`))) return;
      const touched = S.entries.filter((e) => e.account === a.id); for (const e of touched) e.account = null;
      S.accounts = S.accounts.filter((x) => x !== a); await db.putEntries(touched); await saveKV("accounts"); renderSettings();
    } }));
  }));
  $("#pref-lang").value = S.settings.lang; $("#pref-currency").value = S.settings.currency; $("#pref-theme").value = S.settings.theme;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const stamp = () => todayISO();
const hasData = () => S.entries.length > 0 || S.goals.length > 0;
async function replaceState(next) {
  const notes = next.notes && typeof next.notes === "object" ? next.notes : {};
  await db.replaceAll({ entries: next.entries, kv: { categories: next.categories, accounts: next.accounts, goals: next.goals, conclusions: next.conclusions, notes, settings: S.settings } });
  Object.assign(S, { entries: next.entries, categories: next.categories, accounts: next.accounts, goals: next.goals, conclusions: next.conclusions, notes });
  rebuildSuggester();
}
function setupSettings() {
  $("#cat-form").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target, v = f.name.value.trim();
    if (!v || M.findCategory(S.categories, v)) { f.name.setAttribute("aria-invalid", "true"); f.name.focus(); return; }
    f.name.removeAttribute("aria-invalid");
    S.categories.push({ id: M.uid(), name: v.slice(0, 40), kind: f.kind.value, order: Math.max(-1, ...S.categories.map((c) => c.order)) + 1, hidden: false });
    await saveKV("categories"); f.reset(); renderSettings();
  });
  $("#acc-form").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target, v = f.name.value.trim(); if (!v) { f.name.focus(); return; }
    S.accounts.push({ id: M.uid(), name: v.slice(0, 60), last: null }); await saveKV("accounts"); f.reset(); renderSettings();
  });
  $("#import").addEventListener("change", async (ev) => {
    const file = ev.target.files[0]; ev.target.value = ""; if (!file) return;
    if (file.size > 30 * 1024 * 1024) return toast(t("errBig"));
    if (hasData() && !(await confirmBox(t("importReplace")))) return;
    try {
      const { importWorkbook } = await import("./excel.js");
      const r = await importWorkbook(new Uint8Array(await file.arrayBuffer()), { lang: S.settings.lang });
      await replaceState(r);
      const merged = r.warnings.filter((w) => w.issue === "merged").length;
      toast(t("imported", r.entries.length, r.months) + (merged ? " " + t("mergedNote", merged) : ""));
      const last = M.monthsWithData(r.entries).at(-1); go("month", last || M.thisMonth());
    } catch (err) {
      console.error(err);
      toast(err.message === "too-big" ? t("errBig") : err.message === "no-layout" ? t("errLayout") : t("errFile"));
    }
  });
  $("#export").onclick = async () => {
    const { exportWorkbook } = await import("./excel.js");
    download(await exportWorkbook(S, { lang: S.settings.lang, locale: locale(), currency: S.settings.currency }), `${S.settings.lang === "pt" ? "despesas" : "expenses"}-${stamp()}.xlsx`);
  };
  $("#backup").onclick = () => {
    const b = { app: "expenses", version: M.BACKUP_VERSION, saved: new Date().toISOString(), entries: S.entries, categories: S.categories, accounts: S.accounts, goals: S.goals, conclusions: S.conclusions, notes: S.notes, settings: S.settings };
    download(new Blob([JSON.stringify(b)], { type: "application/json" }), `tally-backup-${stamp()}.json`);
  };
  $("#restore").addEventListener("change", async (ev) => {
    const file = ev.target.files[0]; ev.target.value = ""; if (!file) return;
    if (file.size > 60 * 1024 * 1024) return toast(t("errBig"));
    let b; try { b = JSON.parse(await file.text()); } catch { return toast(t("errBackup")); }
    if (M.checkBackup(b)) return toast(t("errBackup"));
    if (hasData() && !(await confirmBox(t("restoreReplace")))) return;
    await replaceState(b); toast(t("savedMsg")); go("month", M.monthsWithData(S.entries).at(-1) || M.thisMonth());
  });
  $("#wipe").onclick = async () => {
    const word = S.settings.lang === "pt" ? "APAGAR" : "DELETE";
    if (!(await confirmBox(t("wipeConfirm"), { typed: word, yes: t("wipe") }))) return;
    await db.wipe(); try { localStorage.clear(); } catch { /* ignore */ }
    location.replace("/");
  };
  $("#pref-lang").onchange = (ev) => setLang(ev.target.value);
  $("#pref-currency").onchange = (ev) => { S.settings.currency = ev.target.value; saveSettings(); };
  $("#pref-theme").onchange = (ev) => { S.settings.theme = ev.target.value; applyTheme(); saveSettings(); };
}
function setLang(l) { S.settings.lang = l === "pt" ? "pt" : "en"; saveSettings(); applyWords(); render(); }

/* ---------- keys (desktop) ---------- */
function setupKeys() {
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest("input, textarea, select, dialog, [contenteditable]")) return;
    if (ev.key === "/") { ev.preventDefault(); go("search"); setTimeout(() => $("#search-form").q.focus()); }
    else if (ev.key === "n") { ev.preventDefault(); go("month", S.month); setTimeout(() => $("#add-form").desc.focus()); }
    else if (ev.key === "[" && S.view === "month") go("month", M.addMonths(S.month, -1));
    else if (ev.key === "]" && S.view === "month") go("month", M.addMonths(S.month, 1));
  });
}

/* ---------- start ---------- */
async function start() {
  let saved = { entries: [], kv: {} };
  try { saved = await db.loadAll(); } catch (err) { console.error(err); }
  const navLang = (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
  S.settings = { lang: navLang, currency: "EUR", theme: "", ...(saved.kv.settings || {}) };
  try { const th = localStorage.getItem("theme"); if (th !== null) S.settings.theme = th; } catch { /* private mode */ }
  S.entries = saved.entries; S.accounts = saved.kv.accounts || []; S.goals = saved.kv.goals || []; S.conclusions = saved.kv.conclusions || {}; S.notes = saved.kv.notes || {};
  S.categories = saved.kv.categories || [];
  if (!S.categories.length) { S.categories = M.defaultCategories(S.settings.lang); db.setKV("categories", S.categories).catch(storageFailed); }
  applyTheme(); applyWords(); rebuildSuggester();
  setupMonth(); setupEdit(); setupSearch(); setupCharts(); setupGoals(); setupSettings(); setupKeys();
  for (const b of $$(".nav button")) b.onclick = () => go(b.dataset.view, b.dataset.view === "month" ? S.month : "");
  $("#lang").onclick = () => setLang(S.settings.lang === "pt" ? "en" : "pt");
  $("#theme").onclick = () => { S.settings.theme = effectiveTheme() === "dark" ? "light" : "dark"; applyTheme(); saveSettings(); };
  window.addEventListener("hashchange", route);
  route();
  document.documentElement.dataset.ready = "1";
  const persisted = await db.persist();
  $("#storage-warn").hidden = persisted || matchMedia("(display-mode: standalone)").matches;
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
start();
