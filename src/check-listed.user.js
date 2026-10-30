// ==UserScript==
// @name         商品管理表 ⇔ メルカリShops ⇔ メルカリ ⇔ ラクマ ⇔ ヤフーフリマ ⇔ ヤフオク 出品チェック
// @namespace    https://sustre-product-sales.vercel.app/products
// @version      16.7.0
// @description  商品管理表・メルカリShops・メルカリ・ラクマ・ヤフーフリマ・ヤフオクの出品状況をチェックしてスプレッドシートへ保存
// @match        https://sustre-product-sales.vercel.app/*
// @match        https://mercari-shops.com/seller/shops/*/products*
// @match        https://jp.mercari.com/mypage/listings*
// @match        https://fril.jp/sell*
// @match        https://paypayfleamarket.yahoo.co.jp/my/item/selling*
// @match        https://auctions.yahoo.co.jp/my/selling*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.xmlHttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(() => {
    'use strict';

    // =========================================================
    // 設定
    // =========================================================

    const CONFIG = {
        hosts: {
            management: 'sustre-product-sales.vercel.app',
            shops: 'mercari-shops.com',
            mercari: 'jp.mercari.com',
            rakuma: 'fril.jp',
            yahoo: 'paypayfleamarket.yahoo.co.jp',
            auctions: 'auctions.yahoo.co.jp'
        },

        session: {
            queryParam: 'check_session'
        },

        storage: {
            management: 'product_management_ids',
            shops: 'product_mercari_shops',
            mercari: 'product_mercari',
            rakuma: 'product_rakuma',
            yahoo: 'product_yahoo_fleamarket',
            yahooPages: 'product_yahoo_fleamarket_pages',
            auctions: 'product_yahoo_auctions',
            auctionsPages: 'product_yahoo_auctions_pages',
            session: 'product_check_session'
        },

        urls: {
            spreadsheetWebhook: 'https://script.google.com/macros/s/AKfycbzo0Uarcepw_JjVUoomWUg9HGX7-zD1FsyIEAposUA3UZnmZb7O2jhWr6fgWfs-V2VCCA/exec',
            spreadsheetWebhookToken: 'CHANGE_ME_TO_A_RANDOM_TOKEN',

            shops:
                'https://mercari-shops.com/seller/shops/9hgq4s8br8tCkqjrszDsPP/products?tab=opened',

            mercari:
                'https://jp.mercari.com/mypage/listings',

            rakuma:
                'https://fril.jp/sell?is_new=0',

            yahoo:
                'https://paypayfleamarket.yahoo.co.jp/my/item/selling',

            auctions:
                'https://auctions.yahoo.co.jp/my/selling'
        },

        selectors: {
            management: {
                row: 'tr.product-data-row',
                id: 'input[name$=":display_id"]',
                name: 'input[name$=":product_name"]',
                status: 'select[name$=":status_id"]',
                listedDays: '[data-product-output-field="listed_days"]',
                purchaseReferencePrice: 'input[name$=":purchase_reference_price"]',
                expectedSalePrice: 'input[name$=":expected_sale_price"]',
                salePriceInput: 'input[name$=":sale_price_input"]',
                pagination: 'nav[aria-label="商品一覧のページ"]',
                currentPage: 'button[aria-current="page"]',
                nextPage: 'button[aria-label="次のページ"]'
            },

            shops: {
                stockFilter:
                    'input[name="productStockCondition"][value="IN_STOCK"]',
                product: '[data-testid="product"]',
                name: '[data-testid="product-name"]'
            },

            mercari: {
                product: '[data-testid="listed-item"]',
                name: '[data-testid="item-label"]',
                loadMore: 'button'
            },

            rakuma: {
                product: '[data-test="item-row"]',
                name: '.deal-item__heading',
                pagination: 'nav.pagination'
            },

            pagination: {
                nextLabel: '次へ'
            },

            yahoo: {
                product: 'a.sc-6e979adf-1.johuSL',
                name: 'p.sc-6e979adf-5.bSuTfP',
                pagination: 'ul.sc-b9407a2c-1.boiNyP'
            },

            auctions: {
                product: 'li:has(a[href*="/jp/auction/"])',
                name: 'a[href*="/jp/auction/"]',
                pagination: '#pagination'
            }
        },

        timeout: {
            normal: 15000,
            mercariLoadMore: 60000,
            mercariPageChange: 10000,
            pageChange: 15000,
            managementPageChange: 15000
        }
    };

    const SpreadsheetSync = {

        dateString(date = new Date()) {
            return [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, '0'),
                String(date.getDate()).padStart(2, '0')
            ].join('-');
        },

        dateTimeString(date = new Date()) {
            return `${this.dateString(date)} ${String(date.getHours()).padStart(2, '0')}:` +
                `${String(date.getMinutes()).padStart(2, '0')}:` +
                `${String(date.getSeconds()).padStart(2, '0')}`;
        },

        metricsRows(results, capturedAt = new Date()) {
            const capturedDate = this.dateTimeString(capturedAt);
            const platforms = [
                ['メルカリShops', 'shops'],
                ['メルカリ', 'mercari'],
                ['ラクマ', 'rakuma'],
                ['ヤフーフリマ', 'yahoo'],
                ['ヤフオク', 'auctions']
            ];

            return results.flatMap(result =>
                platforms.map(([platform, key]) => {
                    const product = result[key];

                    if (!product) {
                        return null;
                    }

                    return {
                        capturedDate,
                        productId: result.id,
                        productName: result.name,
                        platform,
                        listedDays: result.listedDays || '',
                        price: product?.price || '',
                        likeCount: product?.likeCount ?? '',
                        viewCount: product?.viewCount ?? ''
                    };
                }).filter(Boolean)
            );
        },

        activeProducts(results) {
            return results.map(result => ({
                productId: result.id,
                productName: result.name
            }));
        },

        request(url, payload) {
            return new Promise((resolve, reject) => {
                if (
                    typeof GM === 'undefined' ||
                    typeof GM.xmlHttpRequest !== 'function'
                ) {
                    reject(new Error('GM.xmlHttpRequest が利用できません'));
                    return;
                }

                GM.xmlHttpRequest({
                    method: 'POST',
                    url,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify(payload),
                    timeout: 300000,
                    onload: response => {
                        if (response.status < 200 || response.status >= 300) {
                            reject(new Error(`HTTP ${response.status}`));
                            return;
                        }

                        let body;

                        try {
                            body = JSON.parse(response.responseText || '{}');
                        } catch {
                            reject(new Error('Apps Scriptの応答を解析できません'));
                            return;
                        }

                        if (body.ok !== true) {
                            reject(new Error(body.error || 'Apps Scriptがエラーを返しました'));
                            return;
                        }

                        resolve(body);
                    },
                    onerror: () => reject(new Error('スプレッドシートへの送信に失敗しました')),
                    ontimeout: () => reject(new Error('スプレッドシートへの送信がタイムアウトしました'))
                });
            });
        },

        async send(results, unmatched) {
            const url = CONFIG.urls.spreadsheetWebhook.trim();

            if (!url) {
                return true;
            }

            try {
                const capturedAt = new Date();
                const latestRows = ResultsOutput.buildLatestRows(results);
                const metricsRows = this.metricsRows(results, capturedAt);
                const activeProducts = this.activeProducts(results);
                const unmatchedRows = ResultsOutput.buildUnmatchedRows(unmatched);

                Progress.update(
                    `スプレッドシートへ送信中...（${results.length}商品・履歴${metricsRows.length}件）`,
                    96
                );

                await this.request(url, {
                    source: 'auc-tool',
                    token: CONFIG.urls.spreadsheetWebhookToken,
                    sentAt: capturedAt.toISOString(),
                    latestRows,
                    metricsRows,
                    activeProducts,
                    unmatchedRows
                });

                Progress.update(
                    'スプレッドシートへの保存が完了しました。',
                    100
                );
                console.log('[スプレッドシート] 日次データを送信しました');
                return true;
            } catch (error) {
                console.error('[スプレッドシート] 送信失敗:', error);
                alert(
                    'スプレッドシートへの送信に失敗しました。\n\n' +
                    `${error.message}`
                );
                return false;
            }
        }
    };


    // =========================================================
    // DOM / Utility
    // =========================================================

    const $ = (selector, parent = document) =>
        parent.querySelector(selector);

    const $$ = (selector, parent = document) =>
        [...parent.querySelectorAll(selector)];

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    const getData = (key, defaultValue = []) =>
        GM.getValue(key, defaultValue);

    const setData = (key, value) =>
        GM.setValue(key, value);

    const Price = {
        normalize(value) {
            const raw = String(value ?? '').trim();

            if (!raw) {
                return '';
            }

            return raw
                .replace(/[\s,円]/g, '')
                .replace(/[−－]/g, '-');
        },

        formatNumber(value) {
            const raw = String(value ?? '').trim();

            if (!raw) {
                return '';
            }

            const digits = raw.replace(/[^\d]/g, '');

            if (!digits) {
                return '';
            }

            return Number(digits).toLocaleString('en-US');
        }
    };

    const Stats = {
        toNumber(value) {
            const raw = String(value ?? '').trim();
            const digits = raw.replace(/[^\d]/g, '');

            if (!digits) {
                return 0;
            }

            return Number(digits);
        },

        extractShops(record) {
            const values = [...record.querySelectorAll('.css-70qvj9')]
                .map(node => {
                    const text = node.querySelector('p, span')?.textContent || '';
                    return /時間前|分前|秒前|日前|時間$|日$/.test(text)
                        ? null
                        : this.toNumber(text);
                })
                .filter(value => Number.isFinite(value) && value >= 0);

            return {
                likeCount: values[0] ?? 0,
                viewCount: values[1] ?? 0
            };
        },

        extractMercari(record) {
            const countBlocks = [...record.querySelectorAll('.fPSBzf.klFuku.dpfntZ.gasSYy > .fPSBzf')];

            const likeCount = countBlocks
                .find(block => (block.innerHTML || '').includes('M6.89 2.965'))
                ?.querySelector('span')?.textContent || 0;

            const viewCount = countBlocks
                .find(block => (block.innerHTML || '').includes('M2.125 12.41'))
                ?.querySelector('span')?.textContent || 0;

            return {
                likeCount: this.toNumber(likeCount),
                viewCount: this.toNumber(viewCount)
            };
        },

        extractRakuma(record) {
            const likeNode = record.querySelector('[data-test="item_like_count"], [data-testid="item_like_count"]');
            const viewNode = record.querySelector('[data-test="item_view_count"], [data-testid="item_view_count"]');

            return {
                likeCount: likeNode ? this.toNumber(likeNode.textContent) : 0,
                viewCount: viewNode ? this.toNumber(viewNode.textContent) : 0
            };
        },

        extractYahoo(record) {
            const likeNode = record.querySelector('img[src*="icon_favorite"], img[src*="favorite"]')?.closest('div')?.querySelector('span');
            const viewNode = record.querySelector('img[src*="icon_eye"], img[src*="eye"]')?.closest('div')?.querySelector('span');

            return {
                likeCount: likeNode ? this.toNumber(likeNode.textContent) : 0,
                viewCount: viewNode ? this.toNumber(viewNode.textContent) : 0
            };
        },

        extractAuctions(record) {
            const watchNode = [...record.querySelectorAll('li')]
                .find(li => /ウォッチリスト登録数|favorite|watch/i.test(li.textContent || ''));

            return {
                likeCount: watchNode ? this.toNumber(watchNode.textContent) : 0
            };
        },

        extract(record) {
            if (record.querySelector('[data-test="item_like_count"], [data-testid="item_like_count"]')) {
                return this.extractRakuma(record);
            }

            if (record.querySelector('img[src*="icon_favorite"], img[src*="icon_eye"], img[src*="favorite"], img[src*="eye"]')) {
                return this.extractYahoo(record);
            }

            if (record.querySelector('.css-70qvj9')) {
                return this.extractShops(record);
            }

            if (record.querySelector('svg') && record.querySelector('span.dpfntZ')) {
                return this.extractMercari(record);
            }

            if (record.querySelector('li') && /ウォッチリスト登録数|入札数|watch|bid/i.test(record.textContent || '')) {
                return this.extractAuctions(record);
            }

            return {
                likeCount: 0,
                viewCount: 0
            };
        }
    };

    const removeElement = selector =>
        $(selector)?.remove();

    async function waitFor(
        condition,
        timeout = CONFIG.timeout.normal,
        interval = 300
    ) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const result = condition();

            if (result) {
                return result;
            }

            await sleep(interval);
        }

        return null;
    }


    // =========================================================
    // セッション
    // =========================================================

    const Session = {

        create() {
            return (
                Date.now().toString(36) +
                '-' +
                Math.random().toString(36).slice(2)
            );
        },

        fromUrl() {
            return new URLSearchParams(
                location.search
            ).get(CONFIG.session.queryParam);
        },

        async isValid() {
            const urlSession = this.fromUrl();

            if (!urlSession) {
                return false;
            }

            const savedSession = await getData(
                CONFIG.storage.session,
                ''
            );

            return (
                Boolean(savedSession) &&
                savedSession === urlSession
            );
        },

        add(url, session) {
            const target = new URL(url);

            target.searchParams.set(
                CONFIG.session.queryParam,
                session
            );

            return target.toString();
        },

        async clear() {
            await setData(
                CONFIG.storage.session,
                ''
            );
        }
    };


    // =========================================================
    // 進捗表示
    // =========================================================

    const Progress = {

        create() {
            removeElement('#product-check-progress');

            const div = document.createElement('div');

            div.id = 'product-check-progress';

            Object.assign(div.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: 999999,
                width: '300px',
                padding: '12px 14px',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0,0,0,.12)',
                fontSize: '14px'
            });

            div.innerHTML = `
                <div
                    id="product-check-progress-text"
                    style="margin-bottom:8px;font-weight:bold"
                >
                    出品チェック中...
                </div>

                <div
                    style="
                        width:100%;
                        height:8px;
                        background:#eee;
                        border-radius:4px;
                        overflow:hidden;
                    "
                >
                    <div
                        id="product-check-progress-bar"
                        style="
                            width:0%;
                            height:100%;
                            background:#333;
                            transition:width .3s;
                        "
                    ></div>
                </div>
            `;

            document.body.appendChild(div);
        },

        update(text, percent = null) {
            if (!$('#product-check-progress')) {
                this.create();
            }

            const textEl =
                $('#product-check-progress-text');

            const bar =
                $('#product-check-progress-bar');

            if (textEl) {
                textEl.textContent = text;
            }

            if (bar) {
                bar.style.width =
                    percent === null
                        ? '35%'
                        : `${Math.max(
                            0,
                            Math.min(100, percent)
                        )}%`;
            }
        },

        remove() {
            removeElement('#product-check-progress');
        }
    };

    async function clearPaginationState() {
        await Promise.all([
            setData(CONFIG.storage.yahooPages, []),
            setData(CONFIG.storage.auctionsPages, [])
        ]);
    }

    async function clearCheckState() {
        await Promise.all([
            Session.clear(),
            clearPaginationState()
        ]);
        Progress.remove();
    }

    async function abortCheck(message) {
        await clearCheckState();

        if (message) {
            alert(message);
        }
    }

    const COLLECTED_STORAGE_KEYS = [
        'shops',
        'mercari',
        'rakuma',
        'yahoo',
        'auctions',
        'yahooPages',
        'auctionsPages'
    ];

    async function resetCollectedData() {
        await Promise.all(
            COLLECTED_STORAGE_KEYS.map(key =>
                setData(CONFIG.storage[key], [])
            )
        );
    }


    // =========================================================
    // 管理表
    // =========================================================

    const Management = {

        readInputValue(row, selector, suffix) {
            const field =
                $(selector, row) ||
                row.querySelector(`input[name$="${suffix}"]`) ||
                row.querySelector(`input[name$=":${suffix}"]`);

            return field?.value ?? '';
        },

        readTextValue(row, selector, suffix) {
            const field =
                $(selector, row) ||
                row.querySelector(`[data-product-output-field="${suffix}"]`) ||
                row.querySelector(`*[name$="${suffix}"]`) ||
                row.querySelector(`*[name$=":${suffix}"]`);

            const value = field?.value;

            return value !== undefined && value !== ''
                ? value
                : field?.textContent?.trim() || '';
        },

        normalizePrice(value) {
            return Price.normalize(value);
        },

        formatPriceNumber(value) {
            return Price.formatNumber(value);
        },

        formatListedDays(value) {
            const raw = String(value ?? '').trim();

            if (!raw) {
                return '';
            }

            const digits = raw.replace(/[^\d]/g, '');

            if (!digits) {
                return '';
            }

            return `${Number(digits)}日`;
        },

        getStatus(row) {
            return $(
                CONFIG.selectors.management.status,
                row
            )
                ?.selectedOptions?.[0]
                ?.textContent
                ?.trim() || '';
        },

        getProducts(rows = $$(CONFIG.selectors.management.row)) {
            return rows
                .filter(row => {
                    return [
                        '出品中',
                        '委託出品中'
                    ].includes(this.getStatus(row));
                })
                .map(row => ({
                    id:
                        $(
                            CONFIG.selectors.management.id,
                            row
                        )
                            ?.value
                            ?.trim() || '',

                    name:
                        $(
                            CONFIG.selectors.management.name,
                            row
                        )
                            ?.value
                            ?.trim() || '',

                    listingType:
                        this.getStatus(row) === '委託出品中'
                            ? '委託'
                            : '自社',

                    listedDays:
                        this.formatListedDays(
                            this.readTextValue(
                                row,
                                CONFIG.selectors.management.listedDays,
                                'listed_days'
                            )
                        ),

                    purchaseReferencePrice:
                        this.formatPriceNumber(
                            this.normalizePrice(
                                this.readInputValue(
                                    row,
                                    CONFIG.selectors.management.purchaseReferencePrice,
                                    'purchase_reference_price'
                                )
                            )
                        ),

                    expectedSalePrice:
                        this.formatPriceNumber(
                            this.normalizePrice(
                                this.readInputValue(
                                    row,
                                    CONFIG.selectors.management.expectedSalePrice,
                                    'expected_sale_price'
                                )
                            )
                        ),

                    salePriceInput:
                        this.formatPriceNumber(
                            this.normalizePrice(
                                this.readInputValue(
                                    row,
                                    CONFIG.selectors.management.salePriceInput,
                                    'sale_price_input'
                                )
                            )
                        )
                }))
                .filter(product => product.id);
        },

        getPageState() {
            const pagination = $(
                CONFIG.selectors.management.pagination
            );
            const nextButton = $(
                CONFIG.selectors.management.nextPage,
                pagination || document
            );
            const currentPageButton = $(
                CONFIG.selectors.management.currentPage,
                pagination || document
            );
            const currentPageMatch = currentPageButton
                ?.getAttribute('aria-label')
                ?.match(/(\d+)\s*ページ/);
            const pageNumbers = pagination
                ? $$('button[aria-label]', pagination)
                    .map(button =>
                        Number(button.getAttribute('aria-label')?.match(/^(\d+)ページ$/)?.[1])
                    )
                    .filter(Number.isFinite)
                : [];

            return {
                currentPage:
                    Number(currentPageMatch?.[1]) ||
                    1,
                totalPages:
                    Math.max(...pageNumbers, 0) ||
                    1,
            };
        },

        async loadAllProducts(onPageChange) {
            const productsById = new Map();

            while (true) {
                const rows = $$(CONFIG.selectors.management.row);

                this.getProducts(rows).forEach(product => {
                    productsById.set(product.id, product);
                });

                const nextButton = $(
                    CONFIG.selectors.management.nextPage,
                    $(CONFIG.selectors.management.pagination) || document
                );

                if (!nextButton || nextButton.disabled) {
                    break;
                }

                const previousState = this.getPageState();
                onPageChange?.(previousState);
                nextButton.click();

                const changed = await waitFor(() => {
                    const currentState = this.getPageState();

                    return currentState.currentPage !== previousState.currentPage;
                }, CONFIG.timeout.managementPageChange, 300);

                if (!changed) {
                    throw new Error(
                        '管理表のページが切り替わりませんでした。ページ表示を確認して、もう一度お試しください。'
                    );
                }

                await sleep(300);
            }

            return [...productsById.values()];
        }
    };


    // =========================================================
    // 共通商品照合
    // =========================================================

    const Matcher = {

        isStopped(item) {
            return typeof item !== 'string' &&
                /停止中/.test(item?.status || '');
        },

        matches(title, id) {
            const text =
                typeof title === 'string'
                    ? title
                    : title?.title || '';

            return Boolean(
                text &&
                id &&
                text.includes(id)
            );
        },

        find(products, id) {
            return (
                products.find(product =>
                    !this.isStopped(product) &&
                    this.matches(product, id)
                ) || null
            );
        },

        exists(items, id) {
            return items.some(item =>
                this.matches(item, id)
            );
        },

        getUnmatched(items, management) {
            return items.filter(item => {
                const title =
                    typeof item === 'string'
                        ? item
                        : item?.title;

                return this.isStopped(item) ||
                    !management.some(product =>
                        this.matches(title, product.id)
                    );
            });
        }
    };


    // =========================================================
    // メルカリShops
    // =========================================================

    const Shops = {

        async selectInStock() {
            const radio = await waitFor(() =>
                $(
                    CONFIG.selectors.shops.stockFilter
                )
            );

            if (!radio) {
                return false;
            }

            if (!radio.checked) {
                radio.click();
                await sleep(1000);
            }

            return radio.checked;
        },

        getProducts() {
            return $$(CONFIG.selectors.shops.product)
                .map(record => {
                    const title =
                        $(
                            CONFIG.selectors.shops.name,
                            record
                        )
                            ?.textContent
                            ?.trim() || '';

                    const price =
                        Management.formatPriceNumber(
                            record.querySelector('.css-1wgdpkr')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('[data-testid="price"]')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('.deal-item__price')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('.sc-9dbc04ce-0.kXaiYU')
                                ?.textContent
                                ?.trim() ||
                            ''
                        );

                    const counts = title
                        ? Stats.extract(record)
                        : { likeCount: 0, viewCount: 0 };

                    return title
                        ? { title, price, ...counts }
                        : null;
                })
                .filter(Boolean);
        },

        async load() {
            const start = Date.now();

            let previous = -1;
            let stable = 0;

            while (
                Date.now() - start <
                CONFIG.timeout.normal
            ) {
                const titles = this.getProducts();

                if (titles.length === previous) {
                    stable++;
                } else {
                    stable = 0;
                }

                previous = titles.length;

                if (
                    titles.length &&
                    stable >= 2
                ) {
                    return titles;
                }

                await sleep(500);
            }

            return this.getProducts();
        },

        async check() {
            if (!await Session.isValid()) {
                console.log(
                    '[Shops] 通常閲覧のため自動処理しません'
                );
                return;
            }

            Progress.create();
            Progress.update(
                'メルカリShopsの商品を取得中...',
                15
            );

            const management =
                await getData(
                    CONFIG.storage.management
                );

            if (!management.length) {
                await abortCheck(
                    '管理表の商品データがありません。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            if (!await this.selectInStock()) {
                await abortCheck(
                    'メルカリShopsの「販売中」フィルターを設定できませんでした。\n\n' +
                    '商品一覧が表示されているか確認してください。'
                );

                return;
            }

            Progress.update(
                'メルカリShopsの商品一覧を確認中...',
                25
            );

            const titles = await this.load();

            if (!titles.length) {
                await abortCheck(
                    'メルカリShopsの商品を取得できませんでした。\n\n' +
                    '商品一覧が表示されているか確認してください。'
                );

                return;
            }

            await setData(
                CONFIG.storage.shops,
                titles
            );

            console.log(
                '[Shops] 取得:',
                titles.length,
                '件'
            );

            Progress.update(
                'メルカリへ移動中...',
                35
            );

            location.href =
                Session.add(
                    CONFIG.urls.mercari,
                    Session.fromUrl()
                );
        }
    };


    // =========================================================
    // メルカリ
    // =========================================================

    const Mercari = {

        getRecords() {
            return $$(
                CONFIG.selectors.mercari.product
            );
        },

        getProducts() {
            return this.getRecords()
                .map(record => {
                    const title =
                        $(
                            CONFIG.selectors.mercari.name,
                            record
                        )
                            ?.textContent
                            ?.trim() || '';

                    if (!title) {
                        return null;
                    }

                    const price =
                        Management.formatPriceNumber(
                            record.querySelector('[data-testid="price"]')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('.css-1wgdpkr')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('.deal-item__price')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('.sc-9dbc04ce-0.kXaiYU')
                                ?.textContent
                                ?.trim() ||
                            ''
                        );

                    const counts = Stats.extract(record);

                    return {
                        title,
                        price,
                        ...counts,
                        status:
                            record.textContent
                                ?.includes('公開停止中')
                                ? '公開停止中'
                                : '公開中'
                    };
                })
                .filter(Boolean);
        },

        getLoadMoreButton() {
            return $$(CONFIG.selectors.mercari.loadMore).find(button =>
                button.textContent
                    ?.trim() === 'もっと見る'
            );
        },

        async waitForIncrease(before) {
            const start = Date.now();

            while (
                Date.now() - start <
                CONFIG.timeout.mercariPageChange
            ) {
                await sleep(500);

                if (
                    this.getRecords().length >
                    before
                ) {
                    return true;
                }
            }

            return false;
        },

        async loadAll() {
            const start = Date.now();

            console.log(
                '[メルカリ] 全商品読み込み開始'
            );

            while (
                Date.now() - start <
                CONFIG.timeout.mercariLoadMore
            ) {
                const button =
                    this.getLoadMoreButton();

                if (!button) {
                    await sleep(1000);

                    if (!this.getLoadMoreButton()) {
                        break;
                    }

                    continue;
                }

                const before =
                    this.getRecords().length;

                Progress.update(
                    `メルカリの商品を取得中... ${before}件`,
                    null
                );

                button.click();

                const added =
                    await this.waitForIncrease(
                        before
                    );

                if (!added) {
                    await sleep(1000);

                    if (!this.getLoadMoreButton()) {
                        break;
                    }
                }
            }

            const products =
                this.getProducts();

            console.log(
                '[メルカリ] 最終取得:',
                products.length,
                '件'
            );

            return products;
        },

        async check() {
            if (!await Session.isValid()) {
                console.log(
                    '[メルカリ] 通常閲覧のため自動処理しません'
                );
                return;
            }

            Progress.create();
            Progress.update(
                'メルカリの商品を取得中...',
                40
            );

            const [
                management,
                shops
            ] = await Promise.all([
                getData(CONFIG.storage.management),
                getData(CONFIG.storage.shops)
            ]);

            if (
                !management.length ||
                !shops.length
            ) {
                await abortCheck(
                    'チェック用データがありません。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            const mercari =
                await this.loadAll();

            if (!mercari.length) {
                await abortCheck(
                    'メルカリの商品を取得できませんでした。\n\n' +
                    '出品中の商品一覧が表示されているか確認してください。'
                );

                return;
            }

            await setData(
                CONFIG.storage.mercari,
                mercari
            );

            Progress.update(
                'ラクマへ移動中...',
                50
            );

            location.href =
                Session.add(
                    CONFIG.urls.rakuma,
                    Session.fromUrl()
                );
        }
    };


    // =========================================================
    // ラクマ
    // =========================================================

    const Rakuma = {

        getRecords() {
            const records =
                $$(CONFIG.selectors.rakuma.product);

            if (records.length) {
                return records;
            }

            return $$(
                'a[href*="item.fril.jp"], a[href*="/item/"], a[href*="/items/"]'
            );
        },

        getProducts() {
            return this.getRecords()
                .map(record => {
                    const title =
                        $(
                            CONFIG.selectors.rakuma.name,
                            record
                        )
                            ?.textContent
                            ?.trim() ||
                        record.querySelector(
                            '[data-test*="item-name"], [data-testid*="item-name"], [class*="item-name"], [class*="itemName"], a[href*="item.fril.jp"], a[href*="/item/"], a[href*="/items/"]'
                        )
                            ?.textContent
                            ?.trim() ||
                        record.textContent?.trim() || '';

                    if (!title) {
                        return null;
                    }

                    const allAttributeText =
                        record.getAttributeNames()
                            .map(name =>
                                record.getAttribute(name) || ''
                            )
                            .join(' ');

                    const inlinePrice =
                        (
                            record.getAttribute('onclick') || ''
                        ).match(/(?:["'&]|&quot;)?price(?:["'&]|&quot;)?\s*:\s*(\d{3,})/i)?.[1] ||
                        (
                            record.outerHTML || ''
                        ).match(/(?:["'&]|&quot;)?price(?:["'&]|&quot;)?\s*:\s*(\d{3,})/i)?.[1] ||
                        allAttributeText.match(/(?:["'&]|&quot;)?price(?:["'&]|&quot;)?\s*:\s*(\d{3,})/i)?.[1] ||
                        '';

                    const price =
                        Management.formatPriceNumber(
                            record.querySelector('.deal-item__price')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('[data-test="item-price"]')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('[data-testid="price"]')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('.deal-item__price span')
                                ?.textContent
                                ?.trim() ||
                            (inlinePrice ? String(inlinePrice) : '') ||
                            ''
                        );

                    const counts = Stats.extract(record);

                    return {
                        title,
                        price,
                        ...counts,
                        status: '公開中'
                    };
                })
                .filter(Boolean);
        },

        getCurrentPage() {
            return Number(
                $(
                    `${CONFIG.selectors.rakuma.pagination} .current`
                )
                    ?.textContent
                    ?.trim()
            ) || 1;
        },

        getLastPage() {
            const links =
                $$(
                    `${CONFIG.selectors.rakuma.pagination} a`
                );

            let max =
                this.getCurrentPage();

            for (const link of links) {
                const href =
                    link.getAttribute('href') || '';

                const match =
                    href.match(
                        /[?&]page=(\d+)/
                    );

                if (match) {
                    max = Math.max(
                        max,
                        Number(match[1])
                    );
                }

                const text =
                    Number(
                        link.textContent?.trim()
                    );

                if (
                    Number.isFinite(text) &&
                    text > 0
                ) {
                    max = Math.max(max, text);
                }
            }

            return max;
        },

        getNextButton() {
            return $(
                `${CONFIG.selectors.rakuma.pagination} a[rel="next"]`
            );
        },

        getSignature() {
            const products =
                this.getProducts();

            return [
                this.getCurrentPage(),
                products.length,
                products[0]?.title || '',
                products[products.length - 1]?.title || ''
            ].join('|');
        },

        async waitForChange(before) {
            return waitFor(
                () =>
                    this.getSignature() !== before,
                CONFIG.timeout.pageChange,
                300
            );
        },

        async loadAll() {
            const allTitles = [];
            const visited = new Set();

            let page =
                this.getCurrentPage();

            while (true) {
                if (visited.has(page)) {
                    break;
                }

                visited.add(page);

                const titles =
                    await Pagination.waitForProducts(
                        () => this.getProducts()
                    );

                allTitles.push(...titles);

                const maxPage =
                    this.getLastPage();

                const percent =
                    maxPage > 0
                        ? 50 + (page / maxPage) * 45
                        : null;

                Progress.update(
                    `ラクマを確認中... ${page} / ${maxPage}ページ`,
                    percent
                );

                console.log(
                    `[ラクマ] ${page}ページ目:`,
                    titles.length,
                    '件'
                );

                const next =
                    this.getNextButton();

                if (!next) {
                    console.log(
                        '[ラクマ] 最終ページ到達'
                    );
                    break;
                }

                const href =
                    next.getAttribute('href') || '';

                if (!href) {
                    break;
                }

                const nextUrl =
                    new URL(
                        href,
                        location.origin
                    );

                const nextPage =
                    Number(
                        nextUrl.searchParams.get('page')
                    );

                if (
                    !nextPage ||
                    visited.has(nextPage)
                ) {
                    break;
                }

                const before =
                    this.getSignature();

                next.click();

                if (!await this.waitForChange(before)) {
                    console.warn(
                        '[ラクマ] ページ変更を確認できませんでした'
                    );
                    break;
                }

                page =
                    this.getCurrentPage();

                await sleep(300);
            }

            return [
                ...new Set(allTitles)
            ];
        },

        async check() {
            if (!await Session.isValid()) {
                console.log(
                    '[ラクマ] 通常閲覧のため自動処理しません'
                );
                return;
            }

            Progress.create();
            Progress.update(
                'ラクマの出品商品を確認中...',
                50
            );

            const [
                management,
                shops,
                mercari
            ] = await Promise.all([
                getData(CONFIG.storage.management),
                getData(CONFIG.storage.shops),
                getData(CONFIG.storage.mercari)
            ]);

            if (
                !management.length ||
                !shops.length ||
                !mercari.length
            ) {
                await abortCheck(
                    'チェック用データが不足しています。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            const rakuma =
                await this.loadAll();

            if (!rakuma.length) {
                await abortCheck(
                    'ラクマの商品を取得できませんでした。\n\n' +
                    'ラクマの出品中商品一覧が読み込まれているか確認してください。'
                );

                return;
            }

            await setData(
                CONFIG.storage.rakuma,
                rakuma
            );

            console.log(
                '[ラクマ] 最終取得:',
                rakuma.length,
                '件'
            );

            Progress.update(
                'ヤフーフリマへ移動中...',
                95
            );

            location.href =
                Session.add(
                    CONFIG.urls.yahoo,
                    Session.fromUrl()
                );
        }
    };


    // =========================================================
    // ページング共通処理
    // =========================================================

    const Pagination = {

        getCurrentPage() {
            return Number(
                new URLSearchParams(
                    location.search
                ).get('page')
            ) || 1;
        },

        getNextUrl(paginationSelector, nextLabel) {
            const pagination =
                $(paginationSelector);

            if (!pagination) {
                return null;
            }

            const next =
                $$('a', pagination).find(link =>
                    link.textContent
                        ?.trim()
                        .includes(nextLabel)
                );

            const href =
                next?.getAttribute('href');

            return href
                ? new URL(
                    href,
                    location.origin
                ).toString()
                : null;
        },

        async waitForProducts(getProducts) {
            const start = Date.now();
            let previous = -1;
            let stable = 0;

            while (
                Date.now() - start <
                CONFIG.timeout.normal
            ) {
                const products = getProducts();

                if (products.length === previous) {
                    stable++;
                } else {
                    stable = 0;
                }

                previous = products.length;

                if (products.length && stable >= 2) {
                    return products;
                }

                await sleep(500);
            }

            return getProducts();
        },

        unique(products) {
            return [
                ...new Map(
                    products
                        .filter(Boolean)
                        .map(product => [
                            typeof product === 'string'
                                ? product
                                : product?.title,
                            product
                        ])
                        .filter(([title]) => title)
                ).values()
            ];
        },

        async loadAll({
            storageKey,
            platform,
            progressText,
            progressPercent,
            paginationSelector,
            nextLabel,
            getProducts
        }) {
            let allProducts =
                await getData(storageKey, []);
            if (!Array.isArray(allProducts)) {
                allProducts = [];
            }
            const visited = new Set();

            while (true) {
                const page =
                    this.getCurrentPage();

                if (visited.has(page)) {
                    console.warn(
                        `[${platform}] 同一ページを検出:`,
                        page
                    );
                    break;
                }

                visited.add(page);

                Progress.update(
                    `${progressText} ${page}ページ目`,
                    progressPercent
                );

                const products =
                    await this.waitForProducts(
                        getProducts
                    );

                console.log(
                    `[${platform}] ${page}ページ目:`,
                    products.length,
                    '件'
                );

                allProducts = this.unique([
                    ...allProducts,
                    ...products
                ]);

                await setData(
                    storageKey,
                    allProducts
                );

                const nextUrl =
                    this.getNextUrl(
                        paginationSelector,
                        nextLabel
                    );

                if (!nextUrl) {
                    console.log(
                        `[${platform}] 最終ページ到達`
                    );
                    break;
                }

                const nextPage =
                    Number(
                        new URL(nextUrl)
                            .searchParams
                            .get('page')
                    );

                if (
                    !nextPage ||
                    visited.has(nextPage)
                ) {
                    break;
                }

                const target =
                    new URL(nextUrl);

                target.searchParams.set(
                    CONFIG.session.queryParam,
                    Session.fromUrl()
                );

                Progress.update(
                    `${progressText} ${page} → ${nextPage}ページ`,
                    progressPercent
                );

                location.href =
                    target.toString();

                return null;
            }

            return this.unique(allProducts);
        }
    };


    // =========================================================
    // ヤフーフリマ
    // =========================================================

    const Yahoo = {

        getRecords() {
            return $$(
                CONFIG.selectors.yahoo.product
            );
        },

        getProducts() {
            return this.getRecords()
                .map(record => {
                    const title =
                        $(
                            CONFIG.selectors.yahoo.name,
                            record
                        )
                            ?.textContent
                            ?.trim() || '';

                    if (!title) {
                        return null;
                    }

                    const text =
                        record.textContent || '';

                    const stopped =
                        text.includes('公開停止中') ||
                        text.includes('出品停止中') ||
                        text.includes('停止中');

                    const price =
                        Management.formatPriceNumber(
                            record.querySelector('.sc-9dbc04ce-0.kXaiYU')
                                ?.textContent
                                ?.trim() ||
                            record.querySelector('[data-testid="price"]')
                                ?.textContent
                                ?.trim() ||
                            Array.from(record.querySelectorAll('p, span'))
                                .find(node => /[0-9,]+円/.test(node.textContent || ''))
                                ?.textContent
                                ?.trim() ||
                            ''
                        );

                    const counts = Stats.extract(record);

                    return {
                        title,
                        price,
                        ...counts,
                        status:
                            stopped
                                ? '公開停止中'
                                : '公開中'
                    };
                })
                .filter(Boolean);
        },

        async loadAll() {
            return Pagination.loadAll({
                storageKey: CONFIG.storage.yahooPages,
                platform: 'ヤフーフリマ',
                progressText: 'ヤフーフリマを確認中...',
                progressPercent: 95,
                paginationSelector:
                    CONFIG.selectors.yahoo.pagination,
                nextLabel: CONFIG.selectors.pagination.nextLabel,
                getProducts: () => this.getProducts()
            });
        },

        async check() {
            if (!await Session.isValid()) {
                console.log(
                    '[ヤフーフリマ] 通常閲覧のため自動処理しません'
                );
                return;
            }

            Progress.create();
            Progress.update(
                'ヤフーフリマの商品を確認中...',
                95
            );

            const [
                management,
                shops,
                mercari,
                rakuma
            ] = await Promise.all([
                getData(CONFIG.storage.management),
                getData(CONFIG.storage.shops),
                getData(CONFIG.storage.mercari),
                getData(CONFIG.storage.rakuma)
            ]);

            if (
                !management.length ||
                !shops.length ||
                !mercari.length ||
                !rakuma.length
            ) {
                await abortCheck(
                    'チェック用データが不足しています（ラクマの商品データを含む）。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            const yahoo =
                await this.loadAll();

            /*
             * ページ遷移した場合。
             */
            if (yahoo === null) {
                return;
            }

            await setData(
                CONFIG.storage.yahoo,
                yahoo
            );

            /*
             * 最後まで取得できたので一時データを削除
             */
            await clearPaginationState();

            console.log(
                '[ヤフーフリマ] 最終取得:',
                yahoo.length,
                '件'
            );

            Progress.update(
                'ヤフオクへ移動中...',
                98
            );

            location.href =
                Session.add(
                    CONFIG.urls.auctions,
                    Session.fromUrl()
                );
        }
    };


    // =========================================================
    // ヤフオク
    // =========================================================

    const Auctions = {

        getPrice(record, label) {
            const labelNode = [...record.querySelectorAll('span')]
                .find(node => node.textContent?.trim() === label);
            const priceNode = labelNode
                ?.closest('li')
                ?.querySelectorAll('span');

            return [...(priceNode || [])]
                .map(node => node.textContent?.trim() || '')
                .find(text => /^\d[\d,]*円$/.test(text)) || '';
        },

        getProducts() {
            return $$(CONFIG.selectors.auctions.product)
                .map(record => {
                    const title = $$(CONFIG.selectors.auctions.name, record)
                        .map(link => link.textContent?.trim() || '')
                        .find(Boolean) || '';

                    if (!title) {
                        return null;
                    }

                    const currentPrice = this.getPrice(record, '現在');
                    const buyNowPrice = this.getPrice(record, '即決');

                    const price =
                        currentPrice && buyNowPrice
                            ? `${Management.formatPriceNumber(currentPrice)}（即決${Management.formatPriceNumber(buyNowPrice)}）`
                            : Management.formatPriceNumber(currentPrice || buyNowPrice || '');

                    const counts = Stats.extract(record);

                    return {
                        title,
                        price,
                        ...counts,
                        status: '公開中'
                    };
                })
                .filter(Boolean);
        },

        async loadAll() {
            return Pagination.loadAll({
                storageKey: CONFIG.storage.auctionsPages,
                platform: 'ヤフオク',
                progressText: 'ヤフオクを確認中...',
                progressPercent: 99,
                paginationSelector:
                    CONFIG.selectors.auctions.pagination,
                nextLabel: CONFIG.selectors.pagination.nextLabel,
                getProducts: () => this.getProducts()
            });
        },

        async check() {
            if (!await Session.isValid()) {
                console.log(
                    '[ヤフオク] 通常閲覧のため自動処理しません'
                );
                return;
            }

            Progress.create();
            Progress.update(
                'ヤフオクの商品を確認中...',
                99
            );

            const [
                management,
                shops,
                mercari,
                rakuma,
                yahoo
            ] = await Promise.all([
                getData(CONFIG.storage.management),
                getData(CONFIG.storage.shops),
                getData(CONFIG.storage.mercari),
                getData(CONFIG.storage.rakuma),
                getData(CONFIG.storage.yahoo)
            ]);

            if (
                !management.length ||
                !shops.length ||
                !mercari.length ||
                !rakuma.length
            ) {
                await abortCheck(
                    'チェック用データが不足しています（ラクマの商品データを含む）。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );
                return;
            }

            const auctions =
                await this.loadAll();

            if (auctions === null) {
                return;
            }

            await setData(
                CONFIG.storage.auctions,
                auctions
            );

            await clearPaginationState();

            Progress.update(
                '商品を照合して結果を作成中...',
                90
            );

            const results =
                Results.create(
                    management,
                    shops,
                    mercari,
                    rakuma,
                    yahoo,
                    auctions
                );

            const unmatched = {
                mercari: Matcher.getUnmatched(mercari, management),
                shops: Matcher.getUnmatched(shops, management),
                rakuma: Matcher.getUnmatched(rakuma, management),
                yahoo: Matcher.getUnmatched(yahoo, management),
                auctions: Matcher.getUnmatched(auctions, management)
            };

            console.log(
                '[出品チェック] 結果:',
                results
            );

            const spreadsheetSaved =
                await SpreadsheetSync.send(
                    results,
                    unmatched
                );

            await clearCheckState();
            await sleep(500);

            const missing =
                results.filter(
                    product =>
                        product.result === '❌'
                ).length;

            alert(
                '出品チェックが完了しました。\n\n' +
                `対象商品：${results.length}件\n` +
                `✅：${results.length - missing}件\n` +
                `❌：${missing}件\n\n` +
                (
                    spreadsheetSaved
                        ? 'スプレッドシートに保存しました。'
                        : 'スプレッドシートへの保存に失敗しました。'
                )
            );
        }
    };


    // =========================================================
    // 結果作成
    // =========================================================

    const Results = {

        create(
            management,
            shops,
            mercari,
            rakuma,
            yahoo,
            auctions
        ) {
            return management.map(product => {
                const shopsProduct =
                    Matcher.find(
                        shops,
                        product.id
                    );

                const shopsOk =
                    Boolean(shopsProduct);

                const mercariProduct =
                    Matcher.find(
                        mercari,
                        product.id
                    );

                const rakumaProduct =
                    Matcher.find(
                        rakuma,
                        product.id
                    );

                const rakumaOk =
                    Boolean(rakumaProduct);

                const yahooProduct =
                    Matcher.find(
                        yahoo,
                        product.id
                    );

                const auctionsProduct =
                    Matcher.find(
                        auctions,
                        product.id
                    );

                const auctionsOk =
                    Boolean(auctionsProduct);

                const ok =
                    (shopsOk || Boolean(mercariProduct)) &&
                    rakumaOk &&
                    Boolean(yahooProduct) &&
                    auctionsOk;
                const hasAnyMarketplacePrice = [
                    shopsProduct,
                    mercariProduct,
                    rakumaProduct,
                    yahooProduct,
                    auctionsProduct
                ].some(marketplaceProduct =>
                    String(marketplaceProduct?.price || '').trim() !== ''
                );
                const listingCheck =
                    product.listingType === '委託'
                        ? !hasAnyMarketplacePrice
                        : ok;

                return {
                    id: product.id,
                    name: product.name,
                    listingType: product.listingType || '自社',
                    listedDays: product.listedDays || '',
                    purchaseReferencePrice: product.purchaseReferencePrice || '',
                    expectedSalePrice: product.expectedSalePrice || '',
                    salePriceInput: product.salePriceInput || '',
                    shops: shopsProduct,
                    shopsOk,
                    mercari: mercariProduct,
                    rakuma: rakumaProduct,
                    yahoo: yahooProduct,
                    auctions: auctionsProduct,
                    result:
                        listingCheck
                            ? '✅'
                            : '❌'
                };
            });
        }
    };


    // =========================================================
    // スプレッドシート用データ
    // =========================================================

    const ResultsOutput = {

        buildLatestRows(results) {
            const platforms = [
                ['mercari_shops', 'shops'],
                ['mercari', 'mercari'],
                ['rakuma', 'rakuma'],
                ['yahoo_fleamarket', 'yahoo'],
                ['yahoo_auctions', 'auctions']
            ];
            const headers = [
                'product_id',
                'product_name',
                'listing_type',
                'listing_check',
                'listed_days',
                'purchase_reference_price'
            ];

            platforms.forEach(([name]) => {
                headers.push(name);
            });

            return [
                headers,
                ...results.map(result => {
                    const row = [
                        result.id,
                        result.name,
                        result.listingType,
                        result.result,
                        result.listedDays || '',
                        result.purchaseReferencePrice || ''
                    ];

                    platforms.forEach(([, key]) => {
                        const product = result[key];

                        row.push(product?.price || '');
                    });

                    return row;
                })
            ];
        },

        buildUnmatchedRows(unmatched) {
            return [
                ...unmatched.mercari.map(item => [
                    'mercari',
                    item.title || '',
                    item.status || ''
                ]),
                ...unmatched.shops.map(item => [
                    'mercari_shops',
                    typeof item === 'string' ? item : item?.title || '',
                    typeof item === 'string' ? '' : item?.price || ''
                ]),
                ...unmatched.rakuma.map(item => [
                    'rakuma',
                    typeof item === 'string' ? item : item?.title || '',
                    typeof item === 'string' ? '' : item?.price || ''
                ]),
                ...unmatched.yahoo.map(item => [
                    'yahoo_fleamarket',
                    typeof item === 'string' ? item : item?.title || '',
                    typeof item === 'string' ? '' : item?.status || ''
                ]),
                ...unmatched.auctions.map(item => [
                    'yahoo_auctions',
                    typeof item === 'string' ? item : item?.title || '',
                    typeof item === 'string' ? '' : item?.price || ''
                ])
            ];
        }
    };


    // =========================================================
    // 開始ボタン
    // =========================================================

    async function startCheck() {
        const button = document.getElementById('management-check-button');
        const buttonText = button?.textContent;
        let products;

        if (button) {
            button.disabled = true;
        }

        try {
            products = await Management.loadAllProducts(page => {
                if (button) {
                    button.textContent =
                        `管理表を取得中... ${page.currentPage}/${page.totalPages}ページ`;
                }
            });
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = buttonText;
            }
        }

        if (!products.length) {
            alert(
                '「出品中」の商品が見つかりません。\n\n' +
                '商品一覧が表示されているか確認してください。'
            );

            return;
        }

        const session =
            Session.create();

        await Promise.all([
            setData(
                CONFIG.storage.management,
                products
            ),
            resetCollectedData(),

            setData(
                CONFIG.storage.session,
                session
            )
        ]);

        console.log(
            '[出品チェック] 開始:',
            products.length,
            '件'
        );

        window.open(
            Session.add(
                CONFIG.urls.shops,
                session
            ),
            '_blank'
        );
    }


    // =========================================================
    // 管理表ボタン
    // =========================================================

    function addStartButton() {
        const existing =
            document.getElementById('management-check-button');

        if (existing) {
            if (!existing.isConnected) {
                const mountTarget =
                    document.body || document.documentElement;

                if (mountTarget) {
                    mountTarget.appendChild(existing);
                }
            }

            return;
        }

        const button =
            document.createElement('button');

        button.id =
            'management-check-button';

        button.textContent =
            '出品チェック開始';

        Object.assign(button.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 999999,
            padding: '10px 16px',
            border: 'none',
            borderRadius: '7px',
            background: '#222',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow:
                '0 2px 6px rgba(0,0,0,.2)'
        });

        button.addEventListener(
            'click',
            () => runCheck(startCheck)
        );

        const mountTarget =
            document.body || document.documentElement;

        if (!mountTarget) {
            setTimeout(addStartButton, 200);
            return;
        }

        mountTarget.appendChild(button);
    }

    async function runCheck(check) {
        try {
            await check();
        } catch (error) {
            console.error(
                '[出品チェック] 処理中にエラーが発生しました',
                error
            );

            try {
                await clearCheckState();
            } catch (cleanupError) {
                console.error(
                    '[出品チェック] 後始末に失敗しました',
                    cleanupError
                );
                Progress.remove();
            }

            alert(
                '出品チェック中にエラーが発生しました。\n\n' +
                `${error.message}\n\n` +
                '最初から「出品チェック開始」を押してください。'
            );
        }
    }


    // =========================================================
    // 初期化
    // =========================================================

    async function init() {
        if (location.hostname === CONFIG.hosts.management) {
            addStartButton();

            if (!window.__productCheckButtonObserver__) {
                window.__productCheckButtonObserver__ = new MutationObserver(() => {
                    if (!document.getElementById('management-check-button')) {
                        addStartButton();
                    }
                });

                window.__productCheckButtonObserver__.observe(
                    document.documentElement,
                    {
                        childList: true,
                        subtree: true
                    }
                );
            }

            return;
        }

        const checks = {
            [CONFIG.hosts.shops]: Shops,
            [CONFIG.hosts.mercari]: Mercari,
            [CONFIG.hosts.rakuma]: Rakuma,
            [CONFIG.hosts.yahoo]: Yahoo,
            [CONFIG.hosts.auctions]: Auctions
        };
        const site = checks[location.hostname];

        if (site && await Session.isValid()) {
            setTimeout(
                () => runCheck(() => site.check()),
                1000
            );
        }
    }


    // =========================================================
    // 起動
    // =========================================================

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init
        );
    } else {
        init();
    }

})();
