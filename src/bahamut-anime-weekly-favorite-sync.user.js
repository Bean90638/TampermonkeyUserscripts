// ==UserScript==
// @name         巴哈動畫瘋-週期表-收藏顯示愛心
// @author       Brad
// @version      1.0.0
// @description  將本季新番的收藏狀態同步到首頁週期表，已收藏作品會在時間下方顯示愛心，並隨加入或取消收藏即時更新。
// @icon         https://ani.gamer.com.tw/favicon.ico
// @match        https://ani.gamer.com.tw/
// @match        https://ani.gamer.com.tw/index.php*
// @source       https://github.com/Bean90638/TampermonkeyUserscripts/raw/main/src/bahamut-anime-weekly-favorite-sync.user.js
// @namespace    https://github.com/Bean90638/TampermonkeyUserscripts/raw/main/src/bahamut-anime-weekly-favorite-sync.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
// @version      1.1.1

    const FAVORITE_ENTRY_CLASS = 'tm-weekly-favorite-active';
    const STYLE_ID = 'tm-weekly-favorite-sync-style';
    const HOMEPAGE_ROOT_SELECTOR = '.newanime-container';
    const SEASONAL_CARD_SELECTOR = '.newanime-wrap .anime-content-block';
    const SEASONAL_CARD_LINK_SELECTOR = 'a.anime-card-block[href*="animeVideo.php?sn="]';
    const SEASONAL_FAVORITE_BUTTON_SELECTOR = '.btn-card-block.btn-favorite';
    const WEEKLY_ENTRY_SELECTOR = '.day-list a.text-anime-info[href*="animeVideo.php?sn="]';

    let scheduledSyncId = 0;
    let structureObserver = null;
    let isPropagatingFavoriteState = false;
    const buttonObservers = new WeakMap();

    function parseVideoSn(href) {
        if (!href) {
            return null;
        }

        const matched = href.match(/[?&]sn=(\d+)/);
        return matched ? matched[1] : null;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            ${WEEKLY_ENTRY_SELECTOR}.${FAVORITE_ENTRY_CLASS} .text-anime-time {
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 6px;
            }

            ${WEEKLY_ENTRY_SELECTOR}.${FAVORITE_ENTRY_CLASS} .text-anime-time::after {
                content: "\\2665";
                color: var(--btn-favorite-video, #ea81aa);
                font-size: 16px;
                line-height: 1;
                transform: translateX(1px);
            }
        `;

        document.head.appendChild(style);
    }

    function getFavoriteVideoSnSet() {
        const favoriteVideoSnSet = new Set();
        const seasonalCards = document.querySelectorAll(SEASONAL_CARD_SELECTOR);

        for (const seasonalCard of seasonalCards) {
            const cardLink = seasonalCard.querySelector(SEASONAL_CARD_LINK_SELECTOR);
            const favoriteButton = seasonalCard.querySelector(SEASONAL_FAVORITE_BUTTON_SELECTOR);
            if (!cardLink || !favoriteButton) {
                continue;
            }

            const videoSn = parseVideoSn(cardLink.getAttribute('href'));
            if (!videoSn || !favoriteButton.classList.contains('btn-is-active')) {
                continue;
            }

            favoriteVideoSnSet.add(videoSn);
        }

        return favoriteVideoSnSet;
    }

    function getFavoriteButtonVideoSn(button) {
        const seasonalCard = button.closest(SEASONAL_CARD_SELECTOR);
        const cardLink = seasonalCard?.querySelector(SEASONAL_CARD_LINK_SELECTOR);
        return parseVideoSn(cardLink?.getAttribute('href') || '');
    }

    function propagateFavoriteState(button) {
        const videoSn = getFavoriteButtonVideoSn(button);
        if (!videoSn) {
            return;
        }

        const shouldBeActive = button.classList.contains('btn-is-active');
        isPropagatingFavoriteState = true;

        try {
            const seasonalCards = document.querySelectorAll(SEASONAL_CARD_SELECTOR);
            for (const seasonalCard of seasonalCards) {
                const cardLink = seasonalCard.querySelector(SEASONAL_CARD_LINK_SELECTOR);
                const favoriteButton = seasonalCard.querySelector(SEASONAL_FAVORITE_BUTTON_SELECTOR);
                if (!cardLink || !favoriteButton) {
                    continue;
                }

                const currentVideoSn = parseVideoSn(cardLink.getAttribute('href'));
                if (currentVideoSn !== videoSn) {
                    continue;
                }

                favoriteButton.classList.toggle('btn-is-active', shouldBeActive);
            }
        } finally {
            isPropagatingFavoriteState = false;
        }
    }

    function syncWeeklyFavorites() {
        const favoriteVideoSnSet = getFavoriteVideoSnSet();
        const weeklyEntries = document.querySelectorAll(WEEKLY_ENTRY_SELECTOR);

        for (const weeklyEntry of weeklyEntries) {
            const videoSn = parseVideoSn(weeklyEntry.getAttribute('href'));
            if (!videoSn) {
                weeklyEntry.classList.remove(FAVORITE_ENTRY_CLASS);
                continue;
            }

            weeklyEntry.classList.toggle(FAVORITE_ENTRY_CLASS, favoriteVideoSnSet.has(videoSn));
        }
    }

    function scheduleSync() {
        if (scheduledSyncId) {
            return;
        }

        scheduledSyncId = globalThis.setTimeout(() => {
            scheduledSyncId = 0;
            syncWeeklyFavorites();
            observeFavoriteButtons();
        }, 0);
    }

    function observeFavoriteButton(button) {
        if (buttonObservers.has(button)) {
            return;
        }

        const observer = new MutationObserver(mutations => {
            if (mutations.some(mutation => mutation.attributeName === 'class')) {
                if (!isPropagatingFavoriteState) {
                    propagateFavoriteState(button);
                }
                scheduleSync();
            }
        });

        observer.observe(button, {
            attributes: true,
            attributeFilter: ['class'],
        });

        buttonObservers.set(button, observer);
    }

    function observeFavoriteButtons() {
        const favoriteButtons = document.querySelectorAll(`${SEASONAL_CARD_SELECTOR} ${SEASONAL_FAVORITE_BUTTON_SELECTOR}`);
        for (const favoriteButton of favoriteButtons) {
            observeFavoriteButton(favoriteButton);
        }
    }

    function observeStructureChanges() {
        if (structureObserver || !document.body) {
            return;
        }

        structureObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type !== 'childList') {
                    continue;
                }

                if (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0) {
                    continue;
                }

                scheduleSync();
                return;
            }
        });

        structureObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    function init() {
        if (!document.querySelector(HOMEPAGE_ROOT_SELECTOR)) {
            return;
        }

        ensureStyle();
        syncWeeklyFavorites();
        observeFavoriteButtons();
        observeStructureChanges();
        console.info('[巴哈動畫瘋週期表收藏同步愛心 v1.1.1] 已載入');
    }

    init();
})();