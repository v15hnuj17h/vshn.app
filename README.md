# vshn.app

vshn.app is a free, client-side CSV savings and spending analyzer. It turns a transaction export into an editable table, an interactive timeline chart, and a small set of filtered financial summaries.

The app runs entirely in the browser. It does not require an account, a backend, or a build step. CSV data is read locally by the browser and is not uploaded by the app.

## Features

- Open a local CSV transaction file.
- Validate and display transaction data in a table.
- Edit existing rows in place.
- Add or delete transaction rows.
- Highlight invalid dates, amounts, types, methods, and out-of-order dates.
- Jump directly to the first validation error.
- Export corrected data as a CSV file.
- Plot debit, credit, saving amount, or saving rate.
- View daywise or cumulative values.
- Group the timeline by day, week, month, or year.
- Filter analytics by category and payment method.
- View total saving, total credit, total debit, and the current chart point value.
- Pan the chart by dragging and reset its zoom with a double-click.
- Hover over chart points to see exact values and period totals.
- Use the built-in help dialog and keyboard-accessible controls.
- Adapt to desktop and mobile layouts.

## Run Locally

No installation is required.

1. Open the `vshn.app` folder.
2. Double-click `index.html`, or open it in a modern browser.
3. Select **Open CSV** and choose a transaction file.

A local static server also works, for example:

```text
python -m http.server
```

Then open `http://localhost:8000` in a browser.

## CSV Format

The first row must contain these six headers, in this exact order:

```csv
Date,Description,Category,Amount,Type,Method
```

Supported values:

| Column | Required format |
| --- | --- |
| `Date` | Valid `YYYY-MM-DD` date, for example `2026-01-31` |
| `Description` | Free-form transaction description |
| `Category` | Free-form category; blank values appear as `Uncategorised` in analytics |
| `Amount` | Number with up to two decimal places; negative input is treated by magnitude |
| `Type` | `Debit` or `Credit` |
| `Method` | `UPI`, `Cash`, or `Card` |

Example:

```csv
Date,Description,Category,Amount,Type,Method
2026-01-01,Salary,Income,50000,Credit,UPI
2026-01-02,Groceries,Food,1250,Debit,Card
2026-01-03,Bus pass,Transport,800,Debit,Cash
```

The parser supports quoted CSV fields, including descriptions containing commas, line breaks, or double quotes. Extra columns are ignored when a file is opened.

## Typical Workflow

1. Open a CSV file.
2. Review the loaded table and the validation status.
3. Select **Edit CSV** to unlock the cells.
4. Select a row before using **Add Row** or **Delete Row**.
5. Fix any red cells. The **Errors** control focuses the first invalid cell.
6. Select **Save Edits**.
7. Use the analyzer controls to choose a metric, filters, value mode, and timeline scale.
8. Use **Export CSV** to download the corrected table.

Rows are sorted chronologically when loaded and after a valid date edit. Export is disabled until all rows pass validation.

## Analytics

The analyzer calculates:

- **Total saving:** total credit minus total debit.
- **Total credit:** sum of credit transactions.
- **Total debit:** sum of debit transactions.
- **Saving rate:** `(total credit - total debit) / total credit * 100`.

The chart can show:

- Debit
- Credit
- Saving amount
- Saving rate

With **Daywise value**, each bucket shows that period's value. With **Cumulative value**, the chart tracks the running value through the selected timeline. Invalid transaction rows are excluded from analytics and reported below the statistic cards.

## Privacy

The application uses browser APIs to read the selected file, render the table, calculate analytics, and create an export download. There is no sign-up flow or server-side data processing in this project. Closing or refreshing the page clears the in-memory CSV state.

## Project Files

- `vshn.app/index.html` - page structure, controls, accessible labels, and help content.
- `vshn.app/script.js` - CSV parsing, validation, table editing, analytics, chart rendering, and export logic.
- `vshn.app/styles.css` - responsive dark interface styling and layout.

## Technology

- Semantic HTML
- Plain CSS
- Vanilla JavaScript
- HTML Canvas for the timeline chart
- Browser `File`, `Blob`, `URL`, `ResizeObserver`, and Pointer Events APIs

There are currently no external runtime dependencies, package scripts, or build tools.

## Live Version

The HTML metadata identifies the deployed version at:

https://vshn-app.vishnujitha2007.workers.dev/
