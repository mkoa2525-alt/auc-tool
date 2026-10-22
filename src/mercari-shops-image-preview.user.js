// ==UserScript==
// @name         Mercari Shops Fullscreen Image Preview
// @namespace    https://github.com/mkoa2525-alt/auc-tool
// @version      1.0.0
// @description  商品編集画面の画像を拡大表示し、矢印キーで切り替える
// @match        https://mercari-shops.com/seller/shops/*/products*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const IMAGE_SELECTOR = '[data-testid="uploaded-image"]';
    const OVERLAY_ID = 'auc-tool-image-preview';
    let activeIndex = 0;
    let overlay;
    let previewImage;
    let counter;
    let previousFocus;
    let previousOverflow;

    function getImages() {
        return [...document.querySelectorAll(IMAGE_SELECTOR)];
    }

    function closePreview() {
        if (!overlay) return;

        overlay.remove();
        overlay = null;
        document.body.style.overflow = previousOverflow;
        previousFocus?.focus();
    }

    function showImage(index) {
        const images = getImages();
        if (images.length === 0) {
            closePreview();
            return;
        }

        activeIndex = (index + images.length) % images.length;
        previewImage.src = images[activeIndex].src;
        previewImage.alt = `商品画像 ${activeIndex + 1}`;
        counter.textContent = `${activeIndex + 1} / ${images.length}`;
    }

    function createButton(label, text, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', label);
        Object.assign(button.style, {
            border: '1px solid rgba(255, 255, 255, 0.5)',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.65)',
            color: '#fff',
            cursor: 'pointer',
            font: 'inherit',
            padding: '10px 16px'
        });
        button.addEventListener('click', onClick);
        return button;
    }

    function openPreview(index) {
        if (overlay) {
            showImage(index);
            return;
        }

        previousFocus = document.activeElement;
        previousOverflow = document.body.style.overflow;

        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', '商品画像プレビュー');
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.92)',
            color: '#fff',
            padding: '24px',
            boxSizing: 'border-box'
        });

        previewImage = document.createElement('img');
        Object.assign(previewImage.style, {
            display: 'block',
            maxWidth: 'calc(100vw - 160px)',
            maxHeight: 'calc(100vh - 100px)',
            objectFit: 'contain'
        });

        counter = document.createElement('div');
        counter.setAttribute('aria-live', 'polite');
        Object.assign(counter.style, {
            position: 'absolute',
            bottom: '18px',
            left: '50%',
            transform: 'translateX(-50%)',
            font: '16px/1.4 sans-serif'
        });

        const closeButton = createButton('閉じる', '×', closePreview);
        Object.assign(closeButton.style, {
            position: 'absolute',
            top: '16px',
            right: '20px',
            fontSize: '28px',
            lineHeight: '1'
        });

        const previousButton = createButton(
            '前の画像',
            '‹',
            () => showImage(activeIndex - 1)
        );
        const nextButton = createButton(
            '次の画像',
            '›',
            () => showImage(activeIndex + 1)
        );

        Object.assign(previousButton.style, {
            position: 'absolute',
            left: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '36px'
        });
        Object.assign(nextButton.style, {
            position: 'absolute',
            right: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '36px'
        });

        overlay.append(
            previewImage,
            closeButton,
            previousButton,
            nextButton,
            counter
        );
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closePreview();
        });
        document.body.append(overlay);
        document.body.style.overflow = 'hidden';

        showImage(index);
        closeButton.focus();
    }

    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;

        if (event.target.closest('[data-testid="delete_image"]')) return;

        const image = event.target.closest(IMAGE_SELECTOR)
            || event.target
                .closest('[data-testid="sortable-item-draggable-item"]')
                ?.querySelector(IMAGE_SELECTOR);
        if (!image) return;

        const images = getImages();
        const index = images.indexOf(image);
        if (index < 0) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openPreview(index);
    }, true);

    document.addEventListener('keydown', event => {
        if (!overlay) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            closePreview();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showImage(activeIndex - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showImage(activeIndex + 1);
        }
    }, true);
})();
