javascript: (() => {
    const showcaseArea = document.querySelector(".searchShowcaseArea");
    if (!showcaseArea) return;

    // 商品状態ごとの背景色マッピング
    const statusColors = {
        "新品、未使用": "#e6f7ff",
        "未使用に近い": "#f6ffed",
        "目立った傷や汚れなし": "#fffbe6",
        "やや傷や汚れあり": "#fff1f0",
        "傷や汚れあり": "#ffecec",
        "全体的に状態が悪い": "#ffd6d6"
    };

    // 商品状態の背景色を設定する関数
    function setStatusColor(itemElement) {
        const statusLabel = [...itemElement.querySelectorAll("dt")]
            .find(dt => dt.textContent.includes("商品状態"));
        if (!statusLabel) return;
        const status = statusLabel.nextElementSibling?.textContent.trim();
        const color = statusColors[status];
        if (color) itemElement.style.backgroundColor = color;
    }

    // 商品リストを取得・日数でソート
    const items = [...showcaseArea.querySelectorAll(".searchShowcaseType01")]
        .map(el => {
            const daysMatch = el.textContent.match(/\((\d+)日\)/);
            const days = daysMatch ? parseInt(daysMatch[1], 10) : Infinity;
            return { el, days };
        })
        .sort((a, b) => a.days - b.days)
        .map(item => item.el);

    // 並び替え＆色付け
    showcaseArea.append(...items);
    items.forEach(setStatusColor);
})();
