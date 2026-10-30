// ==UserScript==
// @name         EcoAuc 商品詳細カスタマイズ
// @namespace    https://github.com/mkoa2525-alt/auc-tool
// @version      1.3.0
// @description  EcoAucの商品一覧に画像プレビュー、説明文チェック、メモ機能を追加
// @match        https://www.ecoauc.com/*
// @updateURL    https://github.com/mkoa2525-alt/auc-tool/raw/refs/heads/main/src/ecoauc-custom.user.js
// @downloadURL  https://github.com/mkoa2525-alt/auc-tool/raw/refs/heads/main/src/ecoauc-custom.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function() {
        // 設定値まとめ
        const CONFIG = {
            LINK_SELECTOR: 'a[href*="/auction-items/view/"]',
            MAX_RETRY: 5,
            MIN_DELAY: 500,
            MAX_DELAY: 1000,
            IMAGE_HEIGHT: 250,
            WARN_WORDS: ["確認できず", "不鮮明", "未確認", "剥がれ", "臭", "ニオイ", "におい", "破損", "ホック", "ボタン", "リカラー", "欠損", "出来ず"]
        };

        // 汎用スリープ
        const sleep = ms => new Promise(res => setTimeout(res, ms));

        // fetchラッパー（リトライ付き）
        async function fetchWithRetry(url) {
            for (let attempt = 1; attempt <= CONFIG.MAX_RETRY; attempt++) {
                try {
                    const res = await fetch(url, { credentials: "include", cache: "no-store" });
                    if (!res.ok) throw new Error(res.status);
                    return await res.text();
                } catch (err) {
                    if (attempt === CONFIG.MAX_RETRY) throw err;
                    await sleep(2000 * Math.pow(2, attempt - 1) + 1000 * Math.random());
                }
            }
        }

        // シンプルな進捗表示
        function createProgressBar(total) {
            let current = 0;
            const el = document.createElement("div");
            Object.assign(el.style, {
                position: "fixed",
                bottom: "10px",
                left: "10px",
                background: "#000",
                color: "#fff",
                padding: "12px 24px",
                fontSize: "20px",
                zIndex: 99999
            });
            document.body.appendChild(el);
            function update(waitSec) {
                el.textContent = `${current}/${total}` + (waitSec ? ` ⏳${waitSec.toFixed(1)}s` : "");
            }
            update();
            return {
                tick() { current++; update(); },
                wait(sec) { update(sec); },
                done() { el.textContent = "完了"; setTimeout(() => el.remove(), 1000); }
            };
        }

        // 商品詳細HTMLパース
        function parseItemHtml(html) {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const thumbnails = [...doc.querySelectorAll(".thumbnail-container .item-thumbnail.pc-image-area")].map(el => {
                const m = el.style.backgroundImage.match(/url\("(.*?)"\)/);
                return m ? m[1].replace(/(_s|_m)\./, "_o.").split("?")[0] : null;
            }).filter(Boolean);
            // 商品名抽出
            const h2Elem = doc.querySelector(".section-heading h2");
            let name = "";
            if (h2Elem) {
                // 最初の非空テキストノードのみ取得
                const firstText = Array.from(h2Elem.childNodes)
                    .filter(n => n.nodeType === 3 && n.textContent.trim())[0];
                name = firstText ? firstText.textContent.trim() : "";
            }
            const description = doc.querySelector(".item-info.view-form")?.innerText.trim().replace(/\s+/g, " ") || "";
            return { thumbnails, description, name };
        }

        // スタイル付き要素生成
        function createStyledElement(tag, styleObj = {}) {
            const el = document.createElement(tag);
            Object.assign(el.style, styleObj);
            return el;
        }

        // ユーザーID取得（dataLayer優先）
        function getUserId() {
            let id = null;
            if (window.dataLayer && Array.isArray(window.dataLayer)) {
                for (const entry of window.dataLayer) {
                    if (entry && typeof entry === "object" && "userId" in entry) {
                        id = entry.userId;
                        break;
                    }
                }
            }
            if (!id) console.warn("userIdが取得できませんでした。メモ保存は失敗する可能性があります。");
            return id;
        }

        // メモ入力欄と保存ボタンを作成し、イベントをバインド
        function createMemoControls(itemId) {
            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "メモを設定";
            input.style.margin = "8px 8px 0 0";

            const button = document.createElement("button");
            button.textContent = "保存";
            button.style.marginTop = "8px";

            button.addEventListener("click", async () => {
                button.disabled = true;
                const userId = getUserId();
                const csrfToken = document.querySelector('input[name="_csrfToken"]')?.value || "";
                const body = `user_id=${encodeURIComponent(userId)}&auction_item_id=${encodeURIComponent(itemId)}&memo=${encodeURIComponent(input.value)}&_csrfToken=${encodeURIComponent(csrfToken)}`;
                try {
                    const res = await fetch("https://www.ecoauc.com/client/item-memos/add", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "X-Requested-With": "XMLHttpRequest"
                        },
                        credentials: "include",
                        body
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.success && typeof data.memo === "string") {
                            input.value = data.memo;
                            console.log("メモ保存完了: " + data.memo);
                        } else {
                            console.log("メモ保存失敗: " + (data.message || ""));
                        }
                    } else {
                        console.log("メモ保存失敗");
                    }
                } catch {
                    console.log("メモ保存エラー");
                }
                button.disabled = false;
            });

            return { input, button };
        }
    // 画像拡大ビュー生成
    function createImageViewer(sources, startIndex = 0) {
        const imgs = Array.isArray(sources) ? sources.slice() : [sources];
        let idx = startIndex;
        // preload all
        imgs.forEach(src => {
            const image = new Image();
            image.src = src;
        });
        const overlay = createStyledElement("div", {
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999
        });
        const img = createStyledElement("img", {
            maxWidth: "95%",
            maxHeight: "95%",
            borderRadius: "6px",
            boxShadow: "0 0 20px #000",
            cursor: "zoom-out"
        });
        function update() {
            img.src = imgs[idx];
        }
        update();
        overlay.append(img);
        overlay.addEventListener("click", e => {
            if (e.target === overlay || e.target === img) cleanup();
        });
        function onKey(e) {
            if (e.key === "ArrowRight") {
                idx = (idx + 1) % imgs.length;
                update();
            } else if (e.key === "ArrowLeft") {
                idx = (idx - 1 + imgs.length) % imgs.length;
                update();
            } else if (e.key === "Escape" || e.key === "Enter") {
                cleanup();
            }
        }

        function cleanup() {
            document.removeEventListener("keydown", onKey);
            overlay.remove();
        }

        document.addEventListener("keydown", onKey);
        return overlay;
    }

    // サムネイル一覧生成
    function createThumbnails(thumbnails) {
        if (!thumbnails.length) return createStyledElement("div");
        const container = createStyledElement("div", {
            display: "flex",
            gap: "6px",
            marginBottom: "8px",
            overflowX: "auto",
            cursor: "grab"
        });
        container.addEventListener("wheel", function(e) {
            e.preventDefault();
            container.scrollLeft += e.deltaY;
        }, { passive: false });
        thumbnails.forEach((src, i) => {
            const img = createStyledElement("img", {
                height: CONFIG.IMAGE_HEIGHT + "px",
                flexShrink: 0,
                borderRadius: "6px",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
            });
            let retry = 0;
            img.onerror = function() {
                if (retry < 3) {
                    retry++;
                    setTimeout(() => {
                        img.src = src;
                    }, 800 * retry);
                } else {
                    img.style.opacity = "0.3";
                }
            };
            img.src = src;
            img.onclick = () => document.body.appendChild(createImageViewer(thumbnails, i));
            container.appendChild(img);
        });
        return container;
    }

    // 事前入札アラート拡張
    function installBidAlert() {
        const ajax = window.jQuery?.ajax;

        if (typeof ajax !== "function") return;

        window.jQuery.ajax = function(opt) {
            const shouldSuppressAlert =
                opt?.url &&
                [
                    "/client/pre-bids/add",
                    "/client/pre-bids/remove",
                    "/client/timelimit-auctions/bid"
                ].some(path => opt.url.includes(path));

            if (shouldSuppressAlert) {
                const originalSuccess = opt.success;
                opt.success = function(response) {
                    if (response?.success) {
                        console.log("事前入札を保存しました");
                        return;
                    }

                    originalSuccess?.apply(this, arguments);
                };
            }

            return ajax.apply(this, arguments);
        };
    }

    // シングルカラムスタイル適用
    function installSingleColumnStyle() {
        if (document.getElementById("ecoauc-single-column-style")) return;

        const style = document.createElement("style");
        style.id = "ecoauc-single-column-style";
        style.textContent =
            ".item-grid-table-wrap .mb-grid-card{" +
            "flex:0 0 100% !important;max-width:100% !important;width:100% !important;" +
            "}.item-grid-table-wrap .row{" +
            "display:flex !important;flex-direction:column !important;}";
        document.head.appendChild(style);
    }

    // 商品リンク抽出
    function extractItemLinks() {
        const links = [...document.querySelectorAll(CONFIG.LINK_SELECTOR)];
        links.forEach(link => {
            link.target = "_blank";
            link.relList.add("noopener");
        });

        const ids = [...new Set(
            links
                .map(link => link.href.match(/\/view\/(\d+)\//)?.[1])
                .filter(Boolean)
        )];

        return ids.map(id => ({
            id,
            url: `${location.origin}/client/auction-items/view/${id}/Auctions/inspect`
        }));
    }

    function renderItemDetails({ id }, html) {
        const link = document.querySelector(
            `.mb-grid-card a[href*="/view/${id}/"]`
        );
        const card = link?.closest(".mb-grid-card");

        if (!card || card.querySelector(".ecoauc-inline")) return;

        const { thumbnails, description, name } = parseItemHtml(html);
        const info = createStyledElement("div", {
            borderTop: "1px solid #ddd",
            padding: "12px 8px",
            marginTop: "6px",
            fontSize: "13px",
            background: "#fafafa",
            borderRadius: "6px"
        });
        info.className = "ecoauc-inline";
        info.appendChild(createThumbnails(thumbnails));

        let descriptionHtml = description;
        let hasWarning = false;
        CONFIG.WARN_WORDS.forEach(word => {
            const matcher = new RegExp(word, "g");
            hasWarning ||= matcher.test(description);
            descriptionHtml = descriptionHtml.replace(
                matcher,
                `<span style="background:linear-gradient(transparent 60%,#ffeb3b 60%);color:#c62828;font-weight:700;">${word}</span>`
            );
        });

        const descriptionElement = createStyledElement("div", {
            whiteSpace: "pre-wrap",
            margin: "0",
            fontFamily: "inherit"
        });
        descriptionElement.innerHTML = name
            ? `<b style='font-size:15px;'>${name}</b> ${descriptionHtml}`
            : descriptionHtml;

        if (hasWarning) {
            info.style.background = "#fff3e0";
            info.style.border = "2px solid #ff9800";
        }

        info.appendChild(descriptionElement);
        const { input, button } = createMemoControls(id);
        info.append(input, button);
        card.appendChild(info);
    }

    async function loadItemDetails(itemLinks) {
        const progress = createProgressBar(itemLinks.length);

        for (const item of itemLinks) {
            try {
                const delay = Math.floor(
                    Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY)
                ) + CONFIG.MIN_DELAY;
                progress.wait(delay / 1000);
                await sleep(delay);
                renderItemDetails(item, await fetchWithRetry(item.url));
            } catch (error) {
                console.warn(`商品情報を取得できませんでした: ${item.id}`, error);
            }

            progress.tick();
        }

        progress.done();
    }

    // メイン処理
    installBidAlert();
    installSingleColumnStyle();
    const itemLinks = extractItemLinks();

    if (itemLinks.length) {
        document.querySelectorAll(
            ".item-image.item-image-min.pc-image-area"
        ).forEach(element => {
            element.style.display = "none";
        });
        await loadItemDetails(itemLinks);
    } else {
        alert("対象商品なし");
    }
})();
