// ==UserScript==
// @name         Mercari Hide Account Info
// @namespace    https://tampermonkey.net/
// @version      1.0
// @description  Mercariのアカウント表示からアバターとアカウント名を非表示にする
// @match        https://www.mercari.com/*
// @match        https://jp.mercari.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function hideAccountInfo() {
        document.querySelectorAll('.account-button-content').forEach(block => {

            // アバターを非表示
            const avatar = block.querySelector('.merAvatar');

            if (avatar) {
                avatar.style.setProperty(
                    'display',
                    'none',
                    'important'
                );
            }

            // アカウント名を非表示
            const accountName = block.querySelector('p.merText');

            if (accountName) {
                accountName.style.setProperty(
                    'display',
                    'none',
                    'important'
                );
            }
        });
    }

    // 初回実行
    hideAccountInfo();

    // Mercariの動的なDOM変更にも対応
    const observer = new MutationObserver(() => {
        hideAccountInfo();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
