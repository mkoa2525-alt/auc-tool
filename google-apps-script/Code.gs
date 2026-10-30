const WEBHOOK_TOKEN = 'CHANGE_ME_TO_A_RANDOM_TOKEN';
const LATEST_RESULTS_SHEET_NAME = 'check_results_latest';
const UNMATCHED_SHEET_NAME = 'unmatched_products';
const MARKETPLACE_HEADER_IMAGES = {
  mercari_shops: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQOVk2RcsSgdbR7u0y0ZHp-N-e2E6R3Y1Eb9_sfKQSs9_rOPsjTKwaLU6o&s=10',
  mercari: 'https://mochifac.com/wp-content/uploads/2021/10/mercari_logo_vertical.png',
  rakuma: 'https://contents.oricon.co.jp/upimg/news/2231000/2230378/20220405_132734_p_o_4989.jpg',
  yahoo_fleamarket: 'https://yt3.googleusercontent.com/wjDYMGwva6eH2eJ4hhgtW2uGhebLlKZMS8cuglgwTUWACHsaEVTfBZBrKDNgWz9CdeYBB_llrg=s900-c-k-c0x00ffffff-no-rj',
  yahoo_auctions: 'https://storage.monocil.jp/item_images/9fc86431-07d8-47fa-847d-4f1aac19f99e.png'
};
const METRIC_COLUMN_WIDTHS = {
  price: 56,
  like_count: 28,
  view_count: 42
};
const MARKETPLACE_PRICE_HEADERS = [
  'mercari_shops_price',
  'mercari_price',
  'rakuma_price',
  'yahoo_fleamarket_price',
  'yahoo_auctions_price'
];
const LISTING_TYPE_COLORS = {
  '自社': '#eaf3f8',
  '委託': '#fff0e1'
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (!WEBHOOK_TOKEN || payload.token !== WEBHOOK_TOKEN) {
      throw new Error('Invalid webhook token');
    }

    if (
      !Array.isArray(payload.latestRows) ||
      payload.latestRows.length === 0 ||
      !Array.isArray(payload.unmatchedRows)
    ) {
      throw new Error('latestRows and unmatchedRows are required');
    }

    if (
      payload.latestLinks !== undefined &&
      (
        !Array.isArray(payload.latestLinks) ||
        payload.latestLinks.length !== payload.latestRows.length - 1
      )
    ) {
      throw new Error('latestLinks must contain one link row per product');
    }

    writeLatestResults_(payload.latestRows, payload.latestLinks || []);
    writeUnmatched_(payload.unmatchedRows);

    return json_({
      ok: true,
      rows: payload.latestRows.length,
      unmatchedRows: payload.unmatchedRows.length
    });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function getSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  return sheet;
}

function writeLatestResults_(rows, links) {
  const sheet = getSheet_(LATEST_RESULTS_SHEET_NAME);
  const columnCount = getColumnCount_(rows);
  const normalizedRows = normalizeRows_(rows);
  const headers = normalizedRows[0];
  const listingTypeIndex = headers.indexOf('listing_type');
  const metricColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) =>
      Object.keys(METRIC_COLUMN_WIDTHS).some(metric =>
        header.endsWith(`_${metric}`)
      )
    );
  const priceIndexes = MARKETPLACE_PRICE_HEADERS
    .map(header => headers.indexOf(header))
    .filter(index => index >= 0);
  const listingCheckIndex = headers.indexOf('listing_check');

  if (listingCheckIndex >= 0 && priceIndexes.length > 1) {
    for (let rowIndex = 1; rowIndex < normalizedRows.length; rowIndex++) {
      if (hasPriceDifference_(normalizedRows[rowIndex], priceIndexes)) {
        normalizedRows[rowIndex][listingCheckIndex] = '⚠️';
      }
    }
  }

  sheet.getDataRange().breakApart();
  sheet.clear();
  sheet
    .getRange(1, 1, rows.length, columnCount)
    .setValues(normalizedRows);
  if (links.length > 0) {
    setPriceLinks_(sheet, normalizedRows, links, priceIndexes);
  }
  sheet.getRange(1, 1, 1, columnCount)
    .setHorizontalAlignment('center');
  sheet.setColumnWidth(2, 150);
  sheet.setRowHeight(1, 40);

  metricColumns.forEach(({ header, index }) => {
    const metric = Object.keys(METRIC_COLUMN_WIDTHS)
      .find(name => header.endsWith(`_${name}`));

    sheet.setColumnWidth(index + 1, METRIC_COLUMN_WIDTHS[metric]);
  });

  headers.forEach((header, index) => {
    const marketplace = Object.keys(MARKETPLACE_HEADER_IMAGES)
      .find(name => header.startsWith(`${name}_`));

    if (marketplace) {
      sheet.getRange(1, index + 1).setFormula(
        `=IMAGE("${MARKETPLACE_HEADER_IMAGES[marketplace]}", 1)`
      );
    }
  });

  if (rows.length > 1) {
    const body = sheet.getRange(2, 1, rows.length - 1, columnCount);

    body.setHorizontalAlignment('left');
    body.setVerticalAlignment('middle');
    sheet.getRange(2, 1, rows.length - 1, 1)
      .setHorizontalAlignment('right');
    sheet.getRange(2, 5, rows.length - 1, 2)
      .setHorizontalAlignment('right');
    sheet.getRange(2, 4, rows.length - 1, 1)
      .setHorizontalAlignment('center');
    if (columnCount > 6) {
      sheet.getRange(2, 7, rows.length - 1, columnCount - 6)
        .setHorizontalAlignment('right');
    }

    body.setBackgrounds(
      normalizedRows.slice(1).map(row => {
        const color = LISTING_TYPE_COLORS[row[listingTypeIndex]] || '#ffffff';
        return Array(columnCount).fill(color);
      })
    );

    normalizedRows
      .slice(1)
      .forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          if (value === '✅' || value === '❌' || value === '⚠️') {
            sheet.getRange(rowIndex + 2, columnIndex + 1)
              .setHorizontalAlignment('center');
          }
        });
      });
  }

  sheet.setFrozenRows(1);
}

function setPriceLinks_(sheet, rows, links, priceIndexes) {
  priceIndexes.forEach(columnIndex => {
    const richTextValues = rows.slice(1).map((row, rowIndex) => {
      const value = row[columnIndex] ?? '';
      const richText = SpreadsheetApp.newRichTextValue()
        .setText(String(value));
      const url = links[rowIndex]?.[columnIndex];

      if (
        String(value).trim() &&
        typeof url === 'string' &&
        /^https?:\/\//i.test(url)
      ) {
        richText.setLinkUrl(url);
      }

      return [richText.build()];
    });

    sheet
      .getRange(2, columnIndex + 1, richTextValues.length, 1)
      .setRichTextValues(richTextValues);
  });
}

function hasPriceDifference_(row, priceIndexes) {
  const prices = priceIndexes
    .map(index => row[index])
    .filter(value => value !== '' && value !== null && value !== '❌')
    .map(value => {
      const match = String(value).match(/\d[\d,]*/);

      return match
        ? Number(match[0].replace(/,/g, ''))
        : null;
    })
    .filter(value => value !== null && Number.isFinite(value));

  return new Set(prices).size > 1;
}

function writeUnmatched_(rows) {
  const headers = ['platform', 'product_name', 'status_or_price'];
  const sheet = getSheet_(UNMATCHED_SHEET_NAME);

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setFrozenRows(1);
}

function getColumnCount_(rows) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function normalizeRows_(rows) {
  const columnCount = getColumnCount_(rows);

  return rows.map(row => {
    const normalized = row.slice();

    while (normalized.length < columnCount) {
      normalized.push('');
    }

    return normalized;
  });
}

function json_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
