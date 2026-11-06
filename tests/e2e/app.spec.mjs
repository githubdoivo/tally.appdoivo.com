import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { readXlsx } from "../../js/xlsx.js";

const SAMPLE = "tests/fixtures/sample.xlsx";

async function open(page, { lang = "en", hash = "" } = {}) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Content Security Policy/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)); });
  await page.goto(`/${hash}`);
  await page.waitForSelector("html[data-ready]");
  if (lang !== (await page.evaluate(() => (document.documentElement.lang.startsWith("pt") ? "pt" : "en")))) await page.click("#lang");
  return problems;
}
async function importSample(page) {
  await page.goto("/#settings");
  await page.setInputFiles("#import", SAMPLE);
  await expect(page.locator("#toast span")).toContainText(/15/);
}
async function add(page, { desc, amount, cat = null, date = null }) {
  const f = page.locator("#add-form");
  await f.locator('[name="desc"]').fill(desc);
  if (cat) await f.locator('[name="cat"]').selectOption({ label: cat });
  await f.locator('[name="amount"]').fill(amount);
  if (date !== null) await f.locator('[name="date"]').fill(date);
  await f.locator('button[type="submit"]').click();
}
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

test("opens with no errors, no outside requests and no security policy violations", async ({ page }) => {
  const outside = [];
  page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1:4183")) outside.push(r.url()); });
  const problems = await open(page);
  for (const v of ["#month", "#search", "#charts", "#shared", "#goals", "#settings"]) { await page.goto(`/${v}`); await page.waitForTimeout(100); }
  expect(problems).toEqual([]);
  expect(outside).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).toContain("script-src 'self'");
});

test("adding an expense: checks the fields, then saves it, and it is still there after a reload", async ({ page }) => {
  await open(page);
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator("#add-error")).toContainText("Write what it was.");
  await expect(page.locator('#add-form [name="desc"]')).toHaveAttribute("aria-invalid", "true");
  await add(page, { desc: "Groceries", amount: "abc", cat: "Food" });
  await expect(page.locator("#add-error")).toContainText("Enter an amount");
  await add(page, { desc: "Groceries", amount: "12,50", cat: "Food" });
  await expect(page.locator("#entries tbody tr")).toHaveCount(1);
  await expect(page.locator("#st-spent")).toContainText(/12[.,]50/);
  await expect(page.locator('#add-form [name="desc"]')).toBeFocused();
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("#entries tbody tr")).toHaveCount(1);
  await expect(page.locator("#summary")).toContainText("Food");
});

test("the category is suggested from earlier expenses with the same words", async ({ page }) => {
  await open(page);
  await add(page, { desc: "Pingo Doce", amount: "5", cat: "Food" });
  await expect(page.locator("#entries tbody tr")).toHaveCount(1);
  await page.locator('#add-form [name="desc"]').fill("pingo doce");
  await expect(page.locator("#add-suggest")).toHaveText("Suggested: Food");
  await expect(page.locator('#add-form [name="cat"]')).toHaveValue(await page.locator('#add-form [name="cat"] option', { hasText: "Food" }).getAttribute("value"));
});

test("editing and deleting an expense, with undo", async ({ page }) => {
  await open(page);
  await add(page, { desc: "Cinema", amount: "9", cat: "Entertainment" });
  await page.locator("#entries .row-btn").first().click();
  const d = page.locator("#edit");
  await expect(d).toBeVisible();
  await d.locator('[name="amount"]').fill("11.20");
  await d.locator('button[type="submit"]').click();
  await expect(page.locator("#st-spent")).toContainText(/11[.,]20/);
  await page.locator("#entries .row-btn").first().click();
  await d.locator("[data-delete]").click();
  await expect(page.locator("#entries tbody tr")).toHaveCount(0);
  await page.locator("#toast button").click();
  await expect(page.locator("#entries tbody tr")).toHaveCount(1);
});

test("a split bill counts only my share and shows who owes what until it is settled", async ({ page }) => {
  await open(page);
  const f = page.locator("#add-form");
  await f.locator('[name="desc"]').fill("Dinner");
  await f.locator('[name="cat"]').selectOption({ label: "Food" });
  await f.locator('[name="amount"]').fill("60");
  await f.locator(".split-box summary").click();
  await f.locator('[name="splitWith"]').fill("Ana");
  await f.locator("[data-half]").click();
  await f.locator('button[type="submit"]').click();
  await expect(page.locator("#st-spent")).toContainText(/30[.,]00/);
  await page.click('.nav [data-view="shared"]');
  await expect(page.locator("#balances")).toContainText("Ana owes you");
  await expect(page.locator("#balances")).toContainText(/30[.,]00/);
  await page.locator("#open-bills button", { hasText: "Mark as Settled" }).click();
  await expect(page.locator("#balances")).toContainText("All settled");
});

test("months: arrows, keys and the address all move between months", async ({ page }) => {
  await open(page, { hash: "#month/2026-03" });
  await expect(page.locator("#month-title")).toHaveText("March 2026");
  await page.click("#prev"); await expect(page.locator("#month-title")).toHaveText("February 2026");
  await page.click("#next"); await page.click("#next"); await expect(page.locator("#month-title")).toHaveText("April 2026");
  await page.locator("body").press("[");
  await expect(page.locator("#month-title")).toHaveText("March 2026");
  await page.click("#today");
  await expect(page).toHaveURL(new RegExp(`#month/${thisMonth()}$`));
});

test("importing the original spreadsheet layout brings in months, totals, conclusions and accounts", async ({ page }) => {
  await open(page);
  await importSample(page);
  await expect(page.locator("#toast span")).toContainText("1 misspelt categories were merged");
  await page.goto("/#month/2026-01");
  await expect(page.locator("#st-spent")).toContainText(/468[.,]45/);
  await expect(page.locator("#st-saved")).toContainText(/50[.,]00/);
  await expect(page.locator("#conclusion")).toHaveText("mês de teste\nsegunda linha");
  await expect(page.locator("#notes")).toHaveJSProperty("readOnly", true); // a concluded month keeps its notes as they are
  await expect(page.locator("#left-off")).toContainText("Banco A");
  await expect(page.locator("#entries")).toContainText("livro <b>&amp;</b>");
  expect(await page.locator("#entries b").count()).toBe(0);
  await page.goto("/#month/2025-12");
  await expect(page.locator("#entries tbody tr")).toHaveCount(5);
});

test("a file that is not a spreadsheet is refused with a clear message", async ({ page }) => {
  await open(page);
  await page.goto("/#settings");
  await page.setInputFiles("#import", { name: "fake.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("not a zip at all") });
  await expect(page.locator("#toast span")).toHaveText("That file is not a spreadsheet this app can read.");
});

test("Excel export downloads a workbook with the original sheets and every expense", async ({ page }) => {
  await open(page);
  await importSample(page);
  await page.goto("/#settings");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
  expect(dl.suggestedFilename()).toMatch(/^expenses-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const sheets = await readXlsx(await readFile(await dl.path()));
  expect(sheets.map((s) => s.name)).toEqual(["Main", "Goals", "Entries"]);
  expect([...sheets[2].cells.keys()].filter((k) => /^C\d+$/.test(k) && k !== "C1").length).toBe(15);
});

test("backup, delete everything (only after typing the word), then restore", async ({ page }) => {
  await open(page);
  await add(page, { desc: "Coffee", amount: "1,20", cat: "Food" });
  await page.goto("/#settings");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backup")]);
  const backupPath = await dl.path();
  await page.click("#wipe");
  await page.locator("#confirm input").fill("nope");
  await page.locator("#confirm-yes").click();
  await page.goto("/#month"); await expect(page.locator("#entries tbody tr")).toHaveCount(1);
  await page.goto("/#settings");
  await page.click("#wipe");
  await page.locator("#confirm input").fill("delete");
  await page.locator("#confirm-yes").click();
  await page.waitForURL(/\/$/); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("#entries tbody tr")).toHaveCount(0);
  await page.goto("/#settings");
  await page.setInputFiles("#restore", backupPath);
  await expect(page.locator("#entries tbody tr")).toHaveCount(1);
  await page.setInputFiles("#restore", { name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"app":"other"}') });
  await expect(page.locator("#toast span")).toHaveText("That is not a backup from this app.");
});

test("search finds words without accents, filters by category and only-split, and totals the results", async ({ page }) => {
  await open(page);
  await importSample(page);
  await page.goto("/#search");
  await page.locator('#search-form [name="q"]').fill("FARMACIA");
  await expect(page.locator("#found")).toHaveText(/^1 found · €?6[.,]99/);
  await page.locator('#search-form [name="q"]').fill("");
  await page.locator('#search-form [name="cat"]').selectOption({ label: "Casa" });
  await expect(page.locator("#found")).toHaveText(/^3 found · €?1[ ,.]?200[.,]00/);
  await page.locator('#search-form button[type="reset"]').click();
  await expect(page.locator("#found")).toHaveText(/^15 found/);
});

test("charts draw bars with tooltips on keyboard focus, and the numbers are also a table", async ({ page }) => {
  await open(page);
  await importSample(page);
  await page.goto("/#charts");
  await page.locator('#range [data-range="all"]').click();
  await expect(page.locator("#ch-month .bar")).not.toHaveCount(0);
  await page.locator("#ch-month .bar").first().focus();
  await expect(page.locator("#ch-month .tip")).toBeVisible();
  await expect(page.locator("#ch-cat li").first()).toContainText("Casa");
  const btn = page.locator('[data-table="ch-month"]');
  await btn.click();
  await expect(page.locator("#ch-month .chart-table")).toBeVisible();
  await expect(btn).toHaveText("Hide Table");
  await expect(page.locator("#ch-year .bar")).toHaveCount(2);
});

test("goals: create one, add movements, see what is still missing", async ({ page }) => {
  await open(page);
  await page.goto("/#goals");
  await page.locator('#goal-form [name="name"]').fill("Holidays");
  await page.locator('#goal-form [name="target"]').fill("1000");
  await page.locator('#goal-form button[type="submit"]').click();
  const g = page.locator(".goal").first();
  await g.locator('[name="desc"]').fill("January");
  await g.locator('[name="amount"]').fill("250");
  await g.locator('button[type="submit"]').click();
  await expect(page.locator(".goal").first()).toContainText(/750[.,]00/);
  await expect(page.locator('.goal [role="progressbar"]')).toHaveAttribute("aria-valuenow", "25");
});

test("settings: add, rename, reorder, hide and merge categories; add an account", async ({ page }) => {
  await open(page);
  await add(page, { desc: "Bus", amount: "2", cat: "Transport" });
  await page.goto("/#settings");
  await page.locator('#cat-form [name="name"]').fill("Pets");
  await page.locator('#cat-form button[type="submit"]').click();
  await expect(page.locator("#cat-list li").last().locator('input[type="text"]')).toHaveValue("Pets");
  await page.locator("#cat-list li").last().locator('[data-up]').click();
  await expect(page.locator("#cat-list li").nth(-2).locator('input[type="text"]')).toHaveValue("Pets");
  const transport = page.locator("#cat-list li").filter({ has: page.locator('input[value="Transport"]') });
  await transport.locator(".more summary").click();
  await transport.locator("select").last().selectOption({ label: "Other" });
  await page.locator("#confirm-yes").click();
  await expect(page.locator('#cat-list input[value="Transport"]')).toHaveCount(0);
  await page.goto("/#month");
  await expect(page.locator("#entries")).toContainText("Other");
  await page.goto("/#settings");
  await page.locator('#acc-form [name="name"]').fill("Revolut");
  await page.locator('#acc-form button[type="submit"]').click();
  await page.goto("/#month");
  await expect(page.locator('#add-form [name="account"] option', { hasText: "Revolut" })).toHaveCount(1);
});

test("text typed as HTML stays text everywhere", async ({ page }) => {
  await open(page);
  await add(page, { desc: '<img src=x onerror="window.__xss=1">', amount: "1", cat: "Other" });
  await page.goto("/#search");
  await page.goto("/#month");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator("#entries img").count()).toBe(0);
});

test("Portuguese: every label switches, and headings and buttons are in Title Case in both languages", async ({ page }) => {
  await open(page);
  const SMALL = { en: new Set(["a", "an", "and", "the", "of", "in", "on", "at", "to", "for", "by", "as", "or", "not"]), pt: new Set(["o", "a", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos", "nas", "por", "para", "com", "ao", "à", "um", "uma", "como", "não"]) };
  for (const lang of ["en", "pt"]) {
    if (lang === "pt") await page.click("#lang");
    const texts = await page.$$eval("[data-w]", (els) => els.filter((e) => !["P"].includes(e.tagName)).map((e) => e.textContent.trim()).filter(Boolean));
    const bad = [];
    for (const s of texts) {
      const words = s.replace(/[()…:]/g, " ").split(/\s+/).filter(Boolean);
      words.forEach((w, i) => { if (!/^\p{L}/u.test(w)) return; if (i && SMALL[lang].has(w)) return; if (w[0] !== w[0].toUpperCase()) bad.push(`${s} [${w}]`); });
    }
    expect(bad, lang).toEqual([]);
  }
  await expect(page.locator("#v-month h2").first()).toHaveText("Adicionar Despesa");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-PT");
});

test("dark theme follows the switch and is remembered", async ({ page }) => {
  await open(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.click("#theme");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".card")).backgroundColor);
  expect(bg).not.toBe("rgb(255, 253, 248)");
});

for (const view of ["month", "search", "charts", "shared", "goals", "settings"]) {
  test(`${view}: no serious accessibility problems, light and dark`, async ({ page }) => {
    await open(page);
    await importSample(page);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/#${view}${view === "month" ? "/2026-01" : ""}`);
      // let WebKit finish styling the freshly drawn view before measuring colours
      // (headless WebKit styles new rows in a scroller only once it paints, so force one paint)
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${scheme}: ${v.id} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    }
  });
}

test("phone: nothing scrolls sideways and every button is at least 44px tall", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await open(page);
  await importSample(page);
  for (const view of ["month/2026-01", "search", "charts", "shared", "goals", "settings"]) {
    await page.goto(`/#${view}`); await page.waitForTimeout(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), view).toBe(true);
    const small = await page.$$eval("button, a[href], select, input:not([type=checkbox]):not([type=file]), summary", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 43.5 && !e.closest("[hidden], .entries td, svg"); }).map((e) => `${e.tagName} ${e.textContent.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().height)}`));
    expect(small, view).toEqual([]);
  }
});

test("desktop: month view fits side by side and the add form is one row", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only");
  await open(page);
  const side = await page.locator(".col-side").boundingBox(), main = await page.locator(".col-main").boundingBox();
  expect(side.x).toBeGreaterThan(main.x + main.width - 1);
});

test("the privacy page exists in both languages and runs only the frame script", async ({ page }) => {
  await page.goto("/privacy.html");
  await expect(page.locator("h1")).toHaveText(["Privacy", "Privacidade"]);
  await expect(page.locator("script")).toHaveCount(1);
  await expect(page.locator("script")).toHaveAttribute("src", "/js/frame.js");
  await expect(page.locator("body")).toContainText("Nothing.");
});

test("monkey: 150 random taps, keys and typing break nothing", async ({ page }) => {
  test.setTimeout(150000);
  const problems = await open(page);
  await importSample(page);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 150; i++) {
    const r = rnd();
    if (await page.locator("dialog[open]").count()) { await page.keyboard.press("Escape"); continue; }
    if (r < 0.6) {
      const els = await page.$$("button:visible, summary:visible, a[href^='#']:visible, select:visible");
      const el = els[Math.floor(rnd() * els.length)];
      if (el && !(await el.evaluate((e) => e.id === "wipe" || e.closest("#toast")))) await el.click({ timeout: 1000 }).catch(() => {});
    } else if (r < 0.85) {
      const inputs = await page.$$("input:visible:not([type=file]):not([type=checkbox]), textarea:visible");
      const el = inputs[Math.floor(rnd() * inputs.length)];
      if (el) await el.fill(["12,5", "<b>x</b>", "", "-3", "9999999", "café ☕", "2026-01-15"][Math.floor(rnd() * 7)], { timeout: 1000 }).catch(() => {});
    } else await page.keyboard.press(["[", "]", "/", "n", "Enter", "Tab", "Escape"][Math.floor(rnd() * 7)]);
  }
  expect(problems).toEqual([]);
});

test("works offline after the first visit (installable app)", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "service workers need localhost or https; checked in Chrome");
  await page.goto("http://localhost:4183/");
  await page.waitForSelector("html[data-ready]");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await add(page, { desc: "Offline coffee", amount: "1", cat: "Food" });
  await expect(page.locator("#entries tbody tr")).toHaveCount(1);
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("#entries")).toContainText("Offline coffee");
  await page.goto("http://localhost:4183/#charts");
  await expect(page.locator("#ch-month svg")).toBeVisible();
  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  expect(manifest.display).toBe("standalone");
});

/* ---------- phone frame (same as ivolopes.com) ---------- */
test("nothing is pinned to the screen edges (iPhone Safari paints a solid band over it)", async ({ page }) => {
  await open(page);
  await importSample(page);
  await page.locator("#add-form input[name=desc]").fill("x"); // makes the toast possible
  const pinned = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position)).map((el) => el.id || el.className));
  expect(pinned).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe("hidden");
});

test("the window sits scrolled down by the strip above it, and only the page layer scrolls", async ({ page }) => {
  await open(page);
  await importSample(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160);
  const top = await page.locator(".top").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(40);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160);
  await page.locator(".page").evaluate((el) => el.scrollTo(0, 400));
  expect(await page.locator(".page").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("the background covers the whole screen and past it, and is never one flat colour", async ({ page }) => {
  await open(page);
  const vp = page.viewportSize();
  const bg = await page.locator(".bg").evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, img: getComputedStyle(el).backgroundImage }; });
  expect(bg.top).toBeLessThanOrEqual(-150);
  expect(bg.bottom).toBeGreaterThanOrEqual(vp.height);
  expect(bg.w).toBeGreaterThanOrEqual(vp.width);
  expect(bg.img).not.toBe("none");
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await page.locator(".bg").evaluate((el) => getComputedStyle(el).backgroundImage), scheme).not.toBe("none");
  }
});

test("the toast shows inside the screen, above the bottom edge", async ({ page }) => {
  await open(page);
  await importSample(page);
  await page.goto("/#month/2026-01");
  await page.locator(".entries tbody tr").first().click();
  await page.locator("#edit").getByRole("button", { name: /Delete/ }).click();
  const box = await page.locator("#toast").boundingBox();
  const vp = page.viewportSize();
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
});


test("month notes stay editable until the month's conclusion is made; no going to future months", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#next")).toBeDisabled();
  const now = new Date(), cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const future = `${now.getFullYear() + 1}-01`;
  await page.goto(`/#month/${future}`);
  await expect(page.locator("#next")).toBeDisabled();
  await expect(page.locator("#draft")).toBeHidden(); // this month: the conclusion waits for the month to end
  await page.locator("#notes").fill("Car service this month");
  await expect(page.locator("#notes-hint")).not.toBeEmpty();
  await page.locator("#prev").click();
  const f = page.locator("#add-form");
  await f.locator('[name="desc"]').fill("Groceries"); await f.locator('[name="cat"]').selectOption({ label: "Food" }); await f.locator('[name="amount"]').fill("20"); await f.locator('button[type="submit"]').click();
  await page.locator("#notes").fill("A quiet month");
  await page.waitForTimeout(700);
  await page.locator("#draft").click(); await page.locator("#confirm-yes").click();
  await expect(page.locator("#conclusion")).toContainText("A quiet month");
  await expect(page.locator("#notes")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#draft")).toBeHidden();
  void cur;
});

