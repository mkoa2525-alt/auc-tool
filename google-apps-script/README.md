# Google Sheets sync setup

1. Create or open the destination Google Spreadsheet.
2. Open **Extensions > Apps Script**.
3. Replace the default code with [`Code.gs`](./Code.gs).
4. Change `WEBHOOK_TOKEN` in `Code.gs` to a random string.
5. Deploy it as a web app:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the deployed web app URL.
7. Paste the URL and the same token into `CONFIG.urls` in `src/check-listed.js`.
8. Update the userscript.

The script maintains a `check_results_latest` sheet automatically. It contains
English column names for listing status, listing prices, listed days, and
purchase reference prices, and is replaced on each check. Rows with different
prices across two or more marketplaces are highlighted in yellow. For Yahoo
Auctions, the first price shown is used for comparison when both a starting
price and an immediate-purchase price are present.

Unmatched marketplace products are written to the separate
`unmatched_products` sheet and replaced on each check.

It stores snapshots in `metrics_history`. This sheet stores one row per
capture date, product, and platform, including the capture timestamp, like
count, and view count, which can be used directly to create trend charts. If
the check is run multiple times on the same day, the matching rows are
overwritten instead of duplicated. The single `captured_date` column is stored in
`YYYY-MM-DD HH:mm:ss` format. The metrics table contains only the fields
needed for analysis; purchase reference price and listing status are omitted.

The `overview` sheet provides one like-count line chart per product. Each chart
uses `listed_days` on the horizontal axis and a separate line for each
platform. Products that are no longer listed disappear, while newly listed
products are added on the next check.

Chart source data is stored in the hidden `overview_chart_data` sheet.

The older `overview_history`, `active_products`, and `dashboard` sheets are no
longer updated. They can be archived or deleted after confirming the new
`overview` sheet.

Keep the web app URL and token private. Anyone who has both can write data to
the spreadsheet.
