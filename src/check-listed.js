// ==UserScript==
// @name         商品管理表 ⇔ メルカリShops ⇔ メルカリ ⇔ ラクマ ⇔ ヤフーフリマ 出品チェック
// @namespace    https://sustre-product-sales.vercel.app/products
// @version      15.0.0
// @description  商品管理表・メルカリShops・メルカリ・ラクマ・ヤフーフリマの出品状況をチェックしてCSV出力
// @match        https://sustre-product-sales.vercel.app/*
// @match        https://mercari-shops.com/seller/shops/*/products*
// @match        https://jp.mercari.com/mypage/listings*
// @match        https://fril.jp/sell*
// @match        https://paypayfleamarket.yahoo.co.jp/my/item/selling*
// @match        https://auctions.yahoo.co.jp/my/selling*
// @grant        GM.setValue
// @grant        GM.getValue
// ==/UserScript==

(() => {
    'use strict';

    // =========================================================
    // 設定
    // =========================================================

    const CONFIG = {
        keys: {
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
                status: 'select[name$=":status_id"]'
            },

            shops: {
                product: '[data-testid="product"]',
                name: '[data-testid="product-name"]'
            },

            mercari: {
                product: '[data-testid="listed-item"]',
                name: '[data-testid="item-label"]'
            },

            rakuma: {
                product: '[data-test="item-row"]',
                name: '.deal-item__heading',
                pagination: 'nav.pagination'
            },

            yahoo: {
                product: 'a.sc-6e979adf-1.johuSL',
                name: 'p.sc-6e979adf-5.bSuTfP',
                pagination: 'ul.sc-b9407a2c-1.boiNyP'
            },

            auctions: {
                product: 'li.sc-c49ee79a-0.yutKe',
                name: 'a.sc-12236b48-0.iDOKqO',
                pagination: '#pagination'
            }
        },

        timeout: {
            normal: 15000,
            mercariLoadMore: 60000,
            pageChange: 15000
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

    const removeElement = selector =>
        $(selector)?.remove();

    const escapeHtml = value =>
        String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');


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
            ).get('check_session');
        },

        async isValid() {
            const urlSession = this.fromUrl();

            if (!urlSession) {
                return false;
            }

            const savedSession = await getData(
                CONFIG.keys.session,
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
                'check_session',
                session
            );

            return target.toString();
        },

        async clear() {
            await setData(
                CONFIG.keys.session,
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


    // =========================================================
    // 管理表
    // =========================================================

    const Management = {

        getProducts() {
            return $$(CONFIG.selectors.management.row)
                .filter(row => {
                    const status =
                        $(
                            CONFIG.selectors.management.status,
                            row
                        )
                            ?.selectedOptions?.[0]
                            ?.textContent
                            ?.trim();

                    return status === '出品中';
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
                            ?.trim() || ''
                }))
                .filter(product => product.id);
        }
    };


    // =========================================================
    // 共通商品照合
    // =========================================================

    const Matcher = {

        matches(title, id) {
            return Boolean(
                title &&
                id &&
                title.includes(id)
            );
        },

        find(products, id) {
            return (
                products.find(product =>
                    this.matches(product.title, id)
                ) || null
            );
        },

        exists(titles, id) {
            return titles.some(title =>
                this.matches(title, id)
            );
        },

        getUnmatched(items, management) {
            return items.filter(item => {
                const title =
                    typeof item === 'string'
                        ? item
                        : item?.title;

                return !management.some(product =>
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
                    'input[name="productStockCondition"][value="IN_STOCK"]'
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
                .map(record =>
                    $(
                        CONFIG.selectors.shops.name,
                        record
                    )
                        ?.textContent
                        ?.trim() || ''
                )
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
                    CONFIG.keys.management
                );

            if (!management.length) {
                await Session.clear();
                Progress.remove();

                alert(
                    '管理表の商品データがありません。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            if (!await this.selectInStock()) {
                await Session.clear();
                Progress.remove();

                alert(
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
                await Session.clear();
                Progress.remove();

                alert(
                    'メルカリShopsの商品を取得できませんでした。\n\n' +
                    '商品一覧が表示されているか確認してください。'
                );

                return;
            }

            await setData(
                CONFIG.keys.shops,
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

                    return {
                        title,
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
            return $$('button').find(button =>
                button.textContent
                    ?.trim() === 'もっと見る'
            );
        },

        async waitForIncrease(before) {
            const start = Date.now();

            while (
                Date.now() - start < 10000
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
                getData(CONFIG.keys.management),
                getData(CONFIG.keys.shops)
            ]);

            if (
                !management.length ||
                !shops.length
            ) {
                await Session.clear();
                Progress.remove();

                alert(
                    'チェック用データがありません。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            const mercari =
                await this.loadAll();

            if (!mercari.length) {
                await Session.clear();
                Progress.remove();

                alert(
                    'メルカリの商品を取得できませんでした。\n\n' +
                    '出品中の商品一覧が表示されているか確認してください。'
                );

                return;
            }

            await setData(
                CONFIG.keys.mercari,
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

        getProducts() {
            return $$(CONFIG.selectors.rakuma.product)
                .map(record =>
                    $(
                        CONFIG.selectors.rakuma.name,
                        record
                    )
                        ?.textContent
                        ?.trim() || ''
                )
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
                products[0] || '',
                products[products.length - 1] || ''
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
                    this.getProducts();

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
                getData(CONFIG.keys.management),
                getData(CONFIG.keys.shops),
                getData(CONFIG.keys.mercari)
            ]);

            if (
                !management.length ||
                !shops.length ||
                !mercari.length
            ) {
                await Session.clear();
                Progress.remove();

                alert(
                    'チェック用データが不足しています。\n\n' +
                    '最初から「出品チェック開始」を押してください。'
                );

                return;
            }

            const rakuma =
                await this.loadAll();

            await setData(
                CONFIG.keys.rakuma,
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

                    return {
                        title,
                        status:
                            stopped
                                ? '公開停止中'
                                : '公開中'
                    };
                })
                .filter(Boolean);
        },

        getCurrentPage() {
            return Number(
                new URLSearchParams(
                    location.search
                ).get('page')
            ) || 1;
        },

        getNextUrl() {
            const pagination =
                $(
                    CONFIG.selectors.yahoo.pagination
                );

            if (!pagination) {
                return null;
            }

            const next =
                $$('a', pagination).find(link =>
                    link.textContent
                        ?.trim()
                        .includes('次へ')
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

        async waitForProducts() {
            const start = Date.now();

            let previous = -1;
            let stable = 0;

            while (
                Date.now() - start <
                CONFIG.timeout.normal
            ) {
                const products =
                    this.getProducts();

                if (products.length === previous) {
                    stable++;
                } else {
                    stable = 0;
                }

                previous = products.length;

                if (
                    products.length &&
                    stable >= 2
                ) {
                    return products;
                }

                await sleep(500);
            }

            return this.getProducts();
        },

        /*
         * =====================================================
         * Yahooページ取得
         *
         * 重要：
         * ページ遷移する前に、現在ページの商品を
         * GM storageへ保存する。
         *
         * これにより
         *
         * 1ページ目
         * ↓
         * 2ページ目
         * ↓
         * 3ページ目
         *
         * と遷移しても、それまでの商品を失わない。
         * =====================================================
         */

        async loadAll() {
            let allProducts =
                await getData(
                    CONFIG.keys.yahooPages,
                    []
                );

            const visited =
                new Set();

            while (true) {
                const page =
                    this.getCurrentPage();

                if (visited.has(page)) {
                    console.warn(
                        '[ヤフーフリマ] 同一ページを検出:',
                        page
                    );
                    break;
                }

                visited.add(page);

                Progress.update(
                    `ヤフーフリマを確認中... ${page}ページ目`,
                    95
                );

                const products =
                    await this.waitForProducts();

                console.log(
                    `[ヤフーフリマ] ${page}ページ目:`,
                    products.length,
                    '件'
                );

                /*
                 * 現在ページの商品を追加
                 */
                allProducts.push(...products);

                /*
                 * タイトル重複を除去して保存
                 *
                 * ここで保存するのでページ遷移しても残る
                 */
                allProducts = [
                    ...new Map(
                        allProducts.map(product => [
                            product.title,
                            product
                        ])
                    ).values()
                ];

                await setData(
                    CONFIG.keys.yahooPages,
                    allProducts
                );

                const nextUrl =
                    this.getNextUrl();

                if (!nextUrl) {
                    console.log(
                        '[ヤフーフリマ] 最終ページ到達'
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
                    'check_session',
                    Session.fromUrl()
                );

                Progress.update(
                    `ヤフーフリマを確認中... ${page} → ${nextPage}ページ`,
                    95
                );

                location.href =
                    target.toString();

                /*
                 * ページ遷移するためここでは終了。
                 * 次ページのcheckYahoo()から再びloadAll()
                 * が呼ばれ、GM storageに保存した商品を
                 * 引き継ぐ。
                 */
                return null;
            }

            /*
             * 全ページ完了後、ページ蓄積データを返す
             */
            return [
                ...new Map(
                    allProducts.map(product => [
                        product.title,
                        product
                    ])
                ).values()
            ];
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
                getData(CONFIG.keys.management),
                getData(CONFIG.keys.shops),
                getData(CONFIG.keys.mercari),
                getData(CONFIG.keys.rakuma)
            ]);

            if (
                !management.length ||
                !shops.length ||
                !mercari.length ||
                !rakuma.length
            ) {
                await Session.clear();
                await setData(
                    CONFIG.keys.yahooPages,
                    []
                );

                Progress.remove();

                alert(
                    'チェック用データが不足しています。\n\n' +
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
                CONFIG.keys.yahoo,
                yahoo
            );

            /*
             * 最後まで取得できたので一時データを削除
             */
            await setData(
                CONFIG.keys.yahooPages,
                []
            );

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

        getProducts() {
            return $$(CONFIG.selectors.auctions.product)
                .map(record => {
                    const title =
                        $(
                            CONFIG.selectors.auctions.name,
                            record
                        )
                            ?.textContent
                            ?.trim() || '';

                    return title || null;
                })
                .filter(Boolean);
        },

        getCurrentPage() {
            return Number(
                new URLSearchParams(
                    location.search
                ).get('page')
            ) || 1;
        },

        getNextUrl() {
            const pagination =
                $(
                    CONFIG.selectors.auctions.pagination
                );

            if (!pagination) {
                return null;
            }

            const next =
                $$('a', pagination).find(link =>
                    link.textContent
                        ?.trim()
                        .includes('次へ')
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

        getSignature() {
            const products =
                this.getProducts();

            return [
                this.getCurrentPage(),
                products.length,
                products[0] || '',
                products[products.length - 1] || ''
            ].join('|');
        },

        async waitForProducts() {
            const start = Date.now();

            let previous = -1;
            let stable = 0;

            while (
                Date.now() - start <
                CONFIG.timeout.normal
            ) {
                const products =
                    this.getProducts();

                if (products.length === previous) {
                    stable++;
                } else {
                    stable = 0;
                }

                previous = products.length;

                if (
                    products.length &&
                    stable >= 2
                ) {
                    return products;
                }

                await sleep(500);
            }

            return this.getProducts();
        },

        async loadAll() {
            let allTitles =
                await getData(
                    CONFIG.keys.auctionsPages,
                    []
                );

            const visited =
                new Set();

            while (true) {
                const page =
                    this.getCurrentPage();

                if (visited.has(page)) {
                    console.warn(
                        '[ヤフオク] 同一ページを検出:',
                        page
                    );
                    break;
                }

                visited.add(page);

                Progress.update(
                    `ヤフオクを確認中... ${page}ページ目`,
                    99
                );

                const titles =
                    await this.waitForProducts();

                console.log(
                    `[ヤフオク] ${page}ページ目:`,
                    titles.length,
                    '件'
                );

                allTitles.push(...titles);
                allTitles = [...new Set(allTitles)];

                await setData(
                    CONFIG.keys.auctionsPages,
                    allTitles
                );

                const nextUrl =
                    this.getNextUrl();

                if (!nextUrl) {
                    console.log(
                        '[ヤフオク] 最終ページ到達'
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
                    'check_session',
                    Session.fromUrl()
                );

                location.href =
                    target.toString();

                return null;
            }

            return [...new Set(allTitles)];
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
                getData(CONFIG.keys.management),
                getData(CONFIG.keys.shops),
                getData(CONFIG.keys.mercari),
                getData(CONFIG.keys.rakuma),
                getData(CONFIG.keys.yahoo)
            ]);

            if (
                !management.length ||
                !shops.length ||
                !mercari.length ||
                !rakuma.length ||
                !yahoo.length
            ) {
                await Session.clear();
                await setData(
                    CONFIG.keys.auctionsPages,
                    []
                );
                Progress.remove();

                alert(
                    'チェック用データが不足しています。\n\n' +
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
                CONFIG.keys.auctions,
                auctions
            );

            await setData(
                CONFIG.keys.auctionsPages,
                []
            );

            Progress.update(
                '商品を照合してCSVを作成中...',
                100
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
                mercari:
                    Matcher.getUnmatched(
                        mercari,
                        management
                    ),

                shops:
                    Matcher.getUnmatched(
                        shops,
                        management
                    ),

                rakuma:
                    Matcher.getUnmatched(
                        rakuma,
                        management
                    ),

                yahoo:
                    Matcher.getUnmatched(
                        yahoo,
                        management
                    ),

                auctions:
                    Matcher.getUnmatched(
                        auctions,
                        management
                    )
            };

            console.log(
                '[出品チェック] 結果:',
                results
            );

            CSV.download(
                results,
                unmatched
            );

            await Session.clear();
            await sleep(500);
            Progress.remove();

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
                'CSVをダウンロードしました。'
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
                const shopsOk =
                    Matcher.exists(
                        shops,
                        product.id
                    );

                const mercariProduct =
                    Matcher.find(
                        mercari,
                        product.id
                    );

                const rakumaOk =
                    Matcher.exists(
                        rakuma,
                        product.id
                    );

                const yahooProduct =
                    Matcher.find(
                        yahoo,
                        product.id
                    );

                const auctionsOk =
                    Matcher.exists(
                        auctions,
                        product.id
                    );

                const ok =
                    (shopsOk || Boolean(mercariProduct)) &&
                    rakumaOk &&
                    Boolean(yahooProduct) &&
                    auctionsOk;

                return {
                    id: product.id,
                    name: product.name,
                    shops: shopsOk,
                    mercari: mercariProduct,
                    rakuma: rakumaOk,
                    yahoo: yahooProduct,
                    auctions: auctionsOk,
                    result:
                        ok
                            ? '✅'
                            : '❌'
                };
            });
        }
    };


    // =========================================================
    // CSV
    // =========================================================

    const CSV = {

        cell(value) {
            return `"${String(value ?? '')
                .replace(/"/g, '""')}"`;
        },

        platformStatus(product) {
            if (!product) {
                return '×';
            }

            return product.status === '公開停止中'
                ? '○ 公開停止中'
                : '○';
        },

        download(results, unmatched) {
            const rows = [];

            const extraRows = [
                ...unmatched.mercari.map(product => [
                    'メルカリ',
                    product.title,
                    product.status
                ]),

                ...unmatched.shops.map(title => [
                    'メルカリShops',
                    title,
                    ''
                ]),

                ...unmatched.rakuma.map(title => [
                    'ラクマ',
                    title,
                    ''
                ]),

                ...unmatched.yahoo.map(product => [
                    'ヤフーフリマ',
                    product.title,
                    product.status
                ]),

                ...unmatched.auctions.map(title => [
                    'ヤフオク',
                    title,
                    ''
                ])
            ];

            const maxRows =
                Math.max(
                    results.length,
                    extraRows.length
                );

            rows.push([
                '商品ID',
                '商品名',
                'メルカリShops',
                'メルカリ',
                'ラクマ',
                'ヤフーフリマ',
                'ヤフオク',
                '判定',
                '',
                '管理表と紐づかなかった商品',
                '',
                ''
            ]);

            rows.push([
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '種類',
                '商品名',
                '状態'
            ]);

            for (let i = 0; i < maxRows; i++) {
                const result =
                    results[i];

                const extra =
                    extraRows[i];

                rows.push([
                    result?.id ?? '',
                    result?.name ?? '',

                    result
                        ? result.shops
                            ? '○'
                            : '×'
                        : '',

                    result
                        ? this.platformStatus(
                            result.mercari
                        )
                        : '',

                    result
                        ? result.rakuma
                            ? '○'
                            : '×'
                        : '',

                    result
                        ? this.platformStatus(
                            result.yahoo
                        )
                        : '',

                    result
                        ? result.auctions
                            ? '○'
                            : '×'
                        : '',

                    result?.result ?? '',

                    '',

                    extra?.[0] ?? '',
                    extra?.[1] ?? '',
                    extra?.[2] ?? ''
                ]);
            }

            const csv =
                rows
                    .map(row =>
                        row.map(this.cell).join(',')
                    )
                    .join('\r\n');

            const blob =
                new Blob(
                    ['\uFEFF' + csv],
                    {
                        type:
                            'text/csv;charset=utf-8;'
                    }
                );

            const url =
                URL.createObjectURL(blob);

            const link =
                document.createElement('a');

            const date =
                new Date();

            const timestamp =
                date.getFullYear() +
                String(
                    date.getMonth() + 1
                ).padStart(2, '0') +
                String(
                    date.getDate()
                ).padStart(2, '0') +
                '_' +
                String(
                    date.getHours()
                ).padStart(2, '0') +
                String(
                    date.getMinutes()
                ).padStart(2, '0');

            link.href = url;

            link.download =
                `出品チェック結果_${timestamp}.csv`;

            link.click();

            URL.revokeObjectURL(url);
        }
    };


    // =========================================================
    // 開始ボタン
    // =========================================================

    async function startCheck() {
        const products =
            Management.getProducts();

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
                CONFIG.keys.management,
                products
            ),

            setData(
                CONFIG.keys.shops,
                []
            ),

            setData(
                CONFIG.keys.mercari,
                []
            ),

            setData(
                CONFIG.keys.rakuma,
                []
            ),

            setData(
                CONFIG.keys.yahoo,
                []
            ),

            setData(
                CONFIG.keys.auctions,
                []
            ),

            /*
             * Yahooのページ遷移途中で使用する
             * 一時保存領域も開始時に必ずリセット。
             */
            setData(
                CONFIG.keys.yahooPages,
                []
            ),

            setData(
                CONFIG.keys.auctionsPages,
                []
            ),

            setData(
                CONFIG.keys.session,
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
        if ($('#management-check-button')) {
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
            startCheck
        );

        document.body.appendChild(button);
    }


    // =========================================================
    // 初期化
    // =========================================================

    async function init() {
        const host =
            location.hostname;

        /*
         * 管理表
         */
        if (
            host ===
            'sustre-product-sales.vercel.app'
        ) {
            addStartButton();
            return;
        }

        /*
         * メルカリShops
         */
        if (
            host ===
            'mercari-shops.com'
        ) {
            if (await Session.isValid()) {
                setTimeout(
                    () => Shops.check(),
                    1000
                );
            }

            return;
        }

        /*
         * メルカリ
         */
        if (
            host ===
            'jp.mercari.com'
        ) {
            if (await Session.isValid()) {
                setTimeout(
                    () => Mercari.check(),
                    1000
                );
            }

            return;
        }

        /*
         * ラクマ
         */
        if (
            host ===
            'fril.jp'
        ) {
            if (await Session.isValid()) {
                setTimeout(
                    () => Rakuma.check(),
                    1000
                );
            }

            return;
        }

        /*
         * ヤフーフリマ
         */
        if (
            host ===
            'paypayfleamarket.yahoo.co.jp'
        ) {
            if (await Session.isValid()) {
                setTimeout(
                    () => Yahoo.check(),
                    1000
                );
            }

            return;
        }

        /*
         * ヤフオク
         */
        if (
            host ===
            'auctions.yahoo.co.jp'
        ) {
            if (await Session.isValid()) {
                setTimeout(
                    () => Auctions.check(),
                    1000
                );
            }

            return;
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
