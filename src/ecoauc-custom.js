    javascript:(async function() {
        // 設定値まとめ
        const CONFIG = {
            LINK_SELECTOR: 'a[href*="/auction-items/view/"]',
            MAX_RETRY: 5,
            MIN_DELAY: 3000,
            MAX_DELAY: 5000,
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

        // プログレスバー生成
        function createProgressBar(total) {
            let current = 0;
            const wrapper = document.createElement("div");
            wrapper.style.position = "fixed";
            wrapper.style.bottom = "30px";
            wrapper.style.left = "30px";
            wrapper.style.width = "380px";
            wrapper.style.background = "#111";
            wrapper.style.color = "#fff";
            wrapper.style.padding = "16px";
            wrapper.style.borderRadius = "10px";
            wrapper.style.fontSize = "16px";
            wrapper.style.zIndex = "99999";
            wrapper.style.boxShadow = "0 0 20px rgba(0,0,0,0.6)";
            const title = document.createElement("div");
            title.textContent = "📦 EcoAuc Cache Progress";
            title.style.fontWeight = "bold";
            title.style.marginBottom = "10px";
            const barBg = document.createElement("div");
            barBg.style.height = "18px";
            barBg.style.background = "#333";
            barBg.style.borderRadius = "6px";
            barBg.style.overflow = "hidden";
            const bar = document.createElement("div");
            bar.style.height = "100%";
            bar.style.width = "0%";
            bar.style.background = "#00c853";
            bar.style.transition = "width 0.3s";
            barBg.appendChild(bar);
            const status = document.createElement("div");
            status.style.marginTop = "8px";
            wrapper.append(title, barBg, status);
            document.body.appendChild(wrapper);
            function update(waitSec = null) {
                const percent = Math.floor(100 * (current / total));
                bar.style.width = percent + "%";
                status.textContent = `${current}/${total} (${percent}%)` + (waitSec ? ` ⏳待機:${waitSec.toFixed(1)}s` : "");
            }
            return {
                tick() { current++; update(); },
                wait(sec) { update(sec); },
                done() { status.textContent = "🎉 Complete"; setTimeout(() => wrapper.remove(), 3000); }
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
        // ...existing code...
    // 画像拡大ビュー生成
    function createImageViewer(src) {
        const overlay = createStyledElement("div", {
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            cursor: "zoom-out"
        });
        const img = createStyledElement("img", {
            maxWidth: "95%",
            maxHeight: "95%",
            borderRadius: "6px",
            boxShadow: "0 0 20px #000"
        });
        img.src = src;
        overlay.appendChild(img);
        overlay.onclick = () => overlay.remove();
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
        thumbnails.forEach(src => {
            const img = createStyledElement("img", {
                height: CONFIG.IMAGE_HEIGHT + "px",
                flexShrink: 0,
                borderRadius: "6px",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
            });
            let retry = 0;
            function reloadImage(url) {
                img.src = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
            }
            img.onerror = function() {
                if (retry < 3) {
                    retry++;
                    setTimeout(() => reloadImage(src), 800 * retry);
                } else {
                    img.style.opacity = "0.3";
                }
            };
            reloadImage(src);
            img.onclick = () => document.body.appendChild(createImageViewer(img.src));
            container.appendChild(img);
        });
        return container;
    }

    // 事前入札アラート拡張
    (function() {
        const origAjax = $.ajax;
        $.ajax = function(opt) {
            if (opt 
                && opt.url 
                && (opt.url.includes("/client/pre-bids/add") || opt.url.includes("/client/pre-bids/remove") || opt.url.includes("/client/timelimit-auctions/bid"))) {
                const origSuccess = opt.success;
                opt.success = function(res) {
                    if (res && res.success) {
                        console.log("事前入札を保存しました");
                        return;
                    }
                    if (origSuccess) origSuccess.apply(this, arguments);
                };
            }
            return origAjax.apply(this, arguments);
        };
    })();

    // シングルカラムスタイル適用
    (function() {
        if (!document.getElementById("ecoauc-single-column-style")) {
            const style = document.createElement("style");
            style.id = "ecoauc-single-column-style";
            style.innerHTML = `.item-grid-table-wrap .mb-grid-card{flex:0 0 100% !important;max-width:100% !important;width:100% !important;}.item-grid-table-wrap .row{display:flex !important;flex-direction:column !important;}`;
            document.head.appendChild(style);
        }
    })();

    // 商品リンク抽出
    function extractItemLinks() {
        const ids = [...new Set([...document.querySelectorAll(CONFIG.LINK_SELECTOR)].map(el => el.href.match(/\/view\/(\d+)\//)?.[1]).filter(Boolean))];
        return ids.map(id => ({
            id,
            url: `${location.origin}/client/auction-items/view/${id}/Auctions/inspect`
        }));
    }

    // メイン処理
    const itemLinks = extractItemLinks();
    const cache = {};
    function randomDelay() {
        return Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY)) + CONFIG.MIN_DELAY;
    }
    if (itemLinks.length) {
        const progress = createProgressBar(itemLinks.length);
        for (const item of itemLinks) {
            if (cache[item.url]) {
                progress.tick();
                continue;
            }
            try {
                const delay = randomDelay();
                progress.wait(delay / 1000);
                await sleep(delay);
                cache[item.url] = await fetchWithRetry(item.url);
            } catch {}
            progress.tick();
        }
        progress.done();
        // 画像エリア非表示
        document.querySelectorAll(".item-image.item-image-min.pc-image-area").forEach(el => el.style.display = "none");
        // 商品情報インライン表示
        itemLinks.forEach(({ id, url }) => {
            const html = cache[url];
            if (!html) return;
            const linkEl = document.querySelector(`.mb-grid-card a[href*="/view/${id}/"]`);
            if (!linkEl) return;
            const card = linkEl.closest(".mb-grid-card");
            if (!card || card.querySelector(".ecoauc-inline")) return;
            const { thumbnails, description, name } = parseItemHtml(html);
            const infoDiv = createStyledElement("div", {
                borderTop: "1px solid #ddd",
                padding: "12px 8px",
                marginTop: "6px",
                fontSize: "13px",
                background: "#fafafa",
                borderRadius: "6px"
            });
            infoDiv.className = "ecoauc-inline";
            infoDiv.appendChild(createThumbnails(thumbnails));
            // 商品名は説明ブロックの先頭だけに表示
            let descHtml = description;
            let warn = false;
            CONFIG.WARN_WORDS.forEach(word => {
                const reg = new RegExp(word, "g");
                if (reg.test(description)) warn = true;
                descHtml = descHtml.replace(reg, `<span style="background:linear-gradient(transparent 60%,#ffeb3b 60%);color:#c62828;font-weight:700;">${word}</span>`);
            });
            // 商品名と説明を1つのdivで横並び表示
            const descDiv = createStyledElement("div", {
                whiteSpace: "pre-wrap",
                margin: "0",
                fontFamily: "inherit"
            });
            descDiv.innerHTML = name ? `<b style='font-size:15px;'>${name}</b> ${descHtml}` : descHtml;
            if (warn) {
                infoDiv.style.background = "#fff3e0";
                infoDiv.style.border = "2px solid #ff9800";
            }
            infoDiv.appendChild(descDiv);
            card.appendChild(infoDiv);
        });
    } else {
        alert("対象商品なし");
    }
})();
