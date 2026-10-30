const WEBHOOK_TOKEN = 'CHANGE_ME_TO_A_RANDOM_TOKEN';
const METRICS_SHEET_NAME = 'metrics_history';
const OVERVIEW_SHEET_NAME = 'overview';
const LATEST_RESULTS_SHEET_NAME = 'check_results_latest';
const UNMATCHED_SHEET_NAME = 'unmatched_products';
const PLATFORMS = ['メルカリShops', 'メルカリ', 'ラクマ', 'ヤフーフリマ', 'ヤフオク'];
const MARKETPLACE_PRICE_HEADERS = [
  'mercari_shops',
  'mercari',
  'rakuma',
  'yahoo_fleamarket',
  'yahoo_auctions'
];
const LISTING_TYPE_COLORS = {
  '自社': '#eaf3f8',
  '委託': '#fff0e1'
};
const METRICS_HEADERS = [
  'captured_date',
  'product_id',
  'product_name',
  'platform',
  'listed_days',
  'price',
  'like_count',
  'view_count'
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (!WEBHOOK_TOKEN || payload.token !== WEBHOOK_TOKEN) {
      throw new Error('Invalid webhook token');
    }

    if (
      !Array.isArray(payload.latestRows) ||
      payload.latestRows.length === 0 ||
      !Array.isArray(payload.metricsRows) ||
      !Array.isArray(payload.activeProducts) ||
      !Array.isArray(payload.unmatchedRows)
    ) {
      throw new Error('latestRows, metricsRows, activeProducts, and unmatchedRows are required');
    }

    appendMetrics_(payload.metricsRows);
    writeLatestResults_(payload.latestRows);
    writeUnmatched_(payload.unmatchedRows);
    setupOverview_(payload.activeProducts, payload.metricsRows);

    return json_({
      ok: true,
      rows: payload.latestRows.length,
      metricsRows: payload.metricsRows.length,
      activeProducts: payload.activeProducts.length,
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

function writeLatestResults_(rows) {
  const sheet = getSheet_(LATEST_RESULTS_SHEET_NAME);
  const columnCount = getColumnCount_(rows);
  const normalizedRows = normalizeRows_(rows);
  const headers = normalizedRows[0];
  const listingTypeIndex = headers.indexOf('listing_type');
  const priceIndexes = MARKETPLACE_PRICE_HEADERS
    .map(header => headers.indexOf(header))
    .filter(index => index >= 0);
  const listingCheckIndex = headers.indexOf('listing_check');

  if (listingCheckIndex >= 0 && priceIndexes.length > 1) {
    normalizedRows.slice(1).forEach(row => {
      if (hasPriceDifference_(row, priceIndexes)) {
        row[listingCheckIndex] = '⚠️';
      }
    });
  }

  sheet.clear();
  sheet
    .getRange(1, 1, rows.length, columnCount)
    .setValues(normalizedRows);
  sheet.getRange(1, 1, 1, columnCount)
    .setHorizontalAlignment('center');

  if (rows.length > 1) {
    const body = sheet.getRange(2, 1, rows.length - 1, columnCount);

    body.setHorizontalAlignment('left');
    sheet.getRange(2, 1, rows.length - 1, 1)
      .setHorizontalAlignment('right');
    sheet.getRange(2, 5, rows.length - 1, 1)
      .setHorizontalAlignment('right');
    sheet.getRange(2, 6, rows.length - 1, 1)
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
          if (value === '✅' || value === '❌') {
            sheet.getRange(rowIndex + 2, columnIndex + 1)
              .setHorizontalAlignment('center');
          }
        });
      });
  }

  sheet.setFrozenRows(1);
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

function appendMetrics_(metricsRows) {
  const sheet = getSheet_(METRICS_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, METRICS_HEADERS.length)
      .setValues([METRICS_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    const existingHeaders = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];

    if (existingHeaders.join('\u0001') !== METRICS_HEADERS.join('\u0001')) {
      const oldRows = sheet.getLastRow() > 1
        ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
        : [];
      const indexes = Object.fromEntries(
        existingHeaders.map((header, index) => [header, index])
      );
      const sourceColumns = {
        captured_date: ['captured_date', 'captured_at'],
        product_id: ['product_id'],
        product_name: ['product_name'],
        platform: ['platform'],
        price: ['price'],
        like_count: ['like_count'],
        view_count: ['view_count']
      };
      const migratedRows = oldRows.map(row =>
        METRICS_HEADERS.map(header => {
          const source = sourceColumns[header]
            .find(name => indexes[name] !== undefined);

          return source ? row[indexes[source]] : '';
        })
      );

      sheet.clear();
      sheet
        .getRange(1, 1, 1, METRICS_HEADERS.length)
        .setValues([METRICS_HEADERS]);

      if (migratedRows.length > 0) {
        sheet
          .getRange(2, 1, migratedRows.length, METRICS_HEADERS.length)
          .setValues(migratedRows);
      }

      sheet.setFrozenRows(1);
    }
  }

  if (metricsRows.length === 0) {
    return;
  }

  const newRows = metricsRows.map(item => [
    item.capturedDate || '',
    item.productId || '',
    item.productName || '',
    item.platform || '',
    item.listedDays || '',
    item.price || '',
    item.likeCount ?? '',
    item.viewCount ?? ''
  ]);

  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, METRICS_HEADERS.length).getValues()
    : [];
  const rowsByKey = new Map();

  const dateKey = value => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
    }

    return String(value || '').slice(0, 10);
  };

  const rowKey = row => [
    dateKey(row[0]),
    String(row[1] || ''),
    String(row[3] || '')
  ].join('\u0001');

  existingRows.forEach(row => {
    rowsByKey.set(rowKey(row), row);
  });

  newRows.forEach(row => {
    rowsByKey.set(rowKey(row), row);
  });

  const rows = [...rowsByKey.values()];

  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, METRICS_HEADERS.length)
      .clearContent();
  }

  sheet
    .getRange(2, 1, rows.length, METRICS_HEADERS.length)
    .setValues(rows);
}

function setupOverview_(activeProducts, metricsRows) {
  const sheet = getSheet_(OVERVIEW_SHEET_NAME);
  const metricsSheet = getSheet_(METRICS_SHEET_NAME);
  const chartSheet = getSheet_('overview_chart_data');
  const history = metricsSheet.getLastRow() > 1
    ? metricsSheet.getRange(2, 1, metricsSheet.getLastRow() - 1, 8).getValues()
    : [];
  const historyByProduct = new Map();
  const chartRanges = [];
  const platformNames = PLATFORMS;

  history.forEach(row => {
    const productId = String(row[1] || '');
    const platform = String(row[3] || '');

    if (!productId || !platform) {
      return;
    }

    const productHistory = historyByProduct.get(productId) || new Map();
    const platformHistory = productHistory.get(platform) || new Map();
    const listedDays = Number(String(row[4] || '').replace(/[^\d]/g, ''));
    const capturedDate = String(row[0] || '');

    if (Number.isFinite(listedDays) && capturedDate) {
      platformHistory.set(capturedDate, {
        listedDays,
        likes: Number(row[6]) || 0
      });
    }

    productHistory.set(platform, platformHistory);
    historyByProduct.set(productId, productHistory);
  });

  chartSheet.clear();
  chartSheet.hideSheet();

  activeProducts.forEach(product => {
    const productHistory = historyByProduct.get(String(product.productId)) || new Map();
    const dates = [...new Set(
      [...productHistory.values()].flatMap(platformHistory =>
        [...platformHistory.keys()]
      )
    )].sort();
    const rows = [
      ['captured_date', ...platformNames]
    ];

    dates.forEach(capturedDate => {
      rows.push([
        capturedDate,
        ...platformNames.map(platform =>
          productHistory.get(platform)?.get(capturedDate)?.likes ?? ''
        )
      ]);
    });

    if (rows.length < 2) {
      return;
    }

    const startRow = chartSheet.getLastRow() + 1;
    chartSheet
      .getRange(startRow, 1, rows.length, rows[0].length)
      .setValues(rows);
    chartRanges.push({
      productId: product.productId,
      productName: product.productName || product.productId,
      pointCount: rows.length - 1,
      range: chartSheet.getRange(
        startRow,
        1,
        rows.length,
        rows[0].length
      )
    });
  });

  sheet.getDataRange().clearContent();
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));

  chartRanges.forEach((item, index) => {
    const width = Math.min(
      1400,
      Math.max(700, 280 + item.pointCount * 70)
    );
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(item.range)
      .setPosition(1 + index * 20, 1, 0, 0)
      .setOption('title', `${item.productId} | ${item.productName}`)
      .setOption('useFirstColumnAsDomain', true)
      .setOption('backgroundColor', '#ffffff')
      .setOption('chartArea', {
        backgroundColor: '#ffffff'
      })
      .setOption('legend', {
        position: 'bottom',
        textStyle: { color: '#000000' }
      })
      .setOption('series', {
        0: { labelInLegend: 'メルカリShops' },
        1: { labelInLegend: 'メルカリ' },
        2: { labelInLegend: 'ラクマ' },
        3: { labelInLegend: 'ヤフーフリマ' },
        4: { labelInLegend: 'ヤフオク' }
      })
      .setOption('hAxis', {
        title: '取得日時',
        textStyle: { color: '#000000' },
        titleTextStyle: { color: '#000000' },
        gridlines: { color: '#d9d9d9' },
        baselineColor: '#666666'
      })
      .setOption('vAxis', {
        title: 'いいね数',
        textStyle: { color: '#000000' },
        titleTextStyle: { color: '#000000' },
        gridlines: { color: '#d9d9d9' },
        baselineColor: '#666666'
      })
      .setOption('lineWidth', 2)
      .setOption('pointSize', 5)
      .setOption('width', width)
      .setOption('height', 300)
      .build();

    sheet.insertChart(chart);
  });
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
