# Google Sheets sync setup

1. Create or open the destination Google Spreadsheet.
2. Open **Extensions > Apps Script**.
3. Replace the default code with [`Code.gs`](./Code.gs).
4. Change `WEBHOOK_TOKEN` in `Code.gs` to a random string.
5. Deploy it as a web app:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the deployed web app URL.
7. Paste the URL and the same token into `CONFIG.urls` in `src/check-listed.user.js`.
8. Update the userscript.

When `Code.gs` changes after deployment, publish a new web app version from
**Deploy > Manage deployments > Edit > New version** so the webhook uses the
updated code.

The script maintains a `check_results_latest` sheet automatically. It contains
English column names for listing type, listing status, marketplace prices,
listed days, and purchase reference prices, and is replaced on each check.
The product identifier column is named `id`, the `product_name` column is
150 pixels wide, and marketplace metric headers display their supplied logos.
Each product occupies one row, with marketplace price columns followed by
like-count columns and view-count columns. Price columns are 56 pixels wide,
like-count columns are 28 pixels wide, and view-count columns are 42 pixels
wide. Like and view counts are shown without emoji prefixes.
Marketplace price cells link to their corresponding product pages when a link
is available.
The `listing_type` column shows `自社` for `出品中` products and `委託` for
`委託出品中` products. If two or more marketplace prices differ, the
`listing_check` column shows `⚠️`. Missing marketplace prices are left blank.
Rows are highlighted in pale blue for `自社` and pale orange for `委託`.
For Yahoo Auctions, the first price shown is used for comparison when both a
starting price and an immediate-purchase price are present.

Unmatched marketplace products are written to the separate
`unmatched_products` sheet and replaced on each check.

The sync no longer writes metrics history or updates overview charts.
Previously created `metrics_history` and overview sheets are left untouched.

Keep the web app URL and token private. Anyone who has both can write data to
the spreadsheet.
