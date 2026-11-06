# tally.appdoivo.com

**tallydoivo** (the same name in EN and PT; it was Expenses / Despesas, then Ledger, renamed to tallydoivo on 2026-11-06): money month by month, grown out of Ivo's own expenses
spreadsheet. Laptop-first (lots of desktop use) and just as usable on a phone, installable,
works offline. **Everything stays on the device**: no account, no server, no tracking.

## What it does

| Screen | What is there |
| --- | --- |
| Month | Add an expense in one row (description, category, amount, date, account, split), the category suggested from earlier expenses, the month's entries, a summary per category with the biggest expense, savings kept apart from spending, the month's **conclusion** (drafted on the device, editable), and "Where You Left Off" per account. Keys: `n` new, `[` `]` months, `/` search. |
| Search | Every past expense: words (accents ignored), category, from/to month, min/max, only split bills, only not settled; count and total of the results. |
| Charts | Spending by month (last 12, this year, all time), where the money went (by category), spending by year. Hover/keyboard tooltips, every chart also as a table. |
| Split Bills | Who owes whom (paid by me / by them, my share), open bills, mark as settled. Split bills count only my share. |
| Goals | Holidays, savings, loans: target, movements, what is still missing. |
| Settings | Categories (add, rename, reorder, hide, saving vs expense, merge), accounts, Excel import/export, backup/restore, delete everything, language, currency, theme. |

## The spreadsheet

`js/excel.js` reads and writes the original layout: the **Main** sheet with one 3-column block per
month (summary with SUMIF formulas, total over the expense rows only, conclusion, statement), the
"Updated" box (accounts), and the **Goals** sheet. Export adds a flat **Entries** sheet (date, account,
split) for filters and pivots. Near-duplicate categories ("servicos" for "servico") are merged on
import and reported. Checked on a real, multi-year file: every month's total
matches Excel's own, except two where the app is right and the sheet was not (a misspelt category,
and a SUMIF range that stopped 13 rows early).

`js/xlsx.js` is a small dependency-free .xlsx reader/writer (zip via the browser's
Compression Streams): no third-party spreadsheet code touches anyone's money data. Guards: 30 MB
file limit, 200 MB unzipped limit (zip bombs), no XML entities beyond the standard five, text that
looks like a formula is always written as text.

## Files

| Part | File |
| --- | --- |
| Money rules (no DOM, unit-tested) | `js/model.js` |
| Storage (IndexedDB) | `js/db.js` |
| Excel | `js/excel.js`, `js/xlsx.js` |
| Charts (SVG, one series each) | `js/charts.js` |
| Screens | `index.html`, `js/app.js` |
| Words EN/PT | `js/words.js` (Title Case in both languages) |
| Look | `app.css` (tokens at the top) |
| Offline/install | `sw.js`, `manifest.webmanifest`, `icons/` |
| Privacy | `privacy.html` |

**Redesign:** the look comes from ChatGPT mockups (prompts in `DESIGN-PROMPTS.md`). A redesign swaps
the tokens and background at the top of `app.css` (and the icons); the layout and code stay.

## Security

- Content-Security-Policy: only the app's own scripts, no outside hosts at all (`connect-src 'self'`).
- No inline scripts, no third-party fonts or analytics; user text only ever reaches the page through
  `textContent` (an HTML-injection test checks it).
- Imports are size-limited, parsed without executing anything, and replace data only after a confirm;
  "Delete Everything" needs the word typed.
- Asks the browser for persistent storage; warns when it may be cleared (Safari) and offers backups.

## Tests

`npm test`: unit tests (`node --test`) for the money rules, the spreadsheet import/export round trip,
zip bombs and broken files; Playwright on desktop Chrome and iPhone WebKit for every screen: adding,
validating, editing, undo, split bills, months and keys, import/export, backup/restore/wipe, search,
charts, goals, settings, HTML injection, PT/EN Title Case, accessibility (axe, light and dark),
no sideways scroll and 44px touch targets on phones, offline, no outside requests or CSP
violations, and a seeded monkey test. CI runs on every push and daily.

## Later (see COMPLIANCE.md for the App Store path)

Sync between laptop and phone with end-to-end encryption (the server would only ever hold
ciphertext); receipt photos; AI-written conclusions and receipt reading through a Worker with
prepaid credit (like Job); recurring expenses; budgets per category.
