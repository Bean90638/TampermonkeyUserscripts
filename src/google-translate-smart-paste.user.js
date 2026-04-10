// ==UserScript==
// @name         Google 翻譯智慧貼上
// @author       Brad
// @version      1.6.0
// @description  貼上時自動判斷文字或圖片並切換翻譯類型；雙擊 ESC 清空與畫面提示; 設定選項：貼上前清除既有內容、文字模式自動切換目標語言、圖片模式固定偵測語言 → 中文(繁體)。
// @icon         https://translate.google.com/favicon.ico
// @match        https://translate.google.*/*
// @source       https://github.com/Bean90638/TampermonkeyUserscripts/raw/main/src/google-translate-smart-paste.user.js
// @namespace    https://github.com/Bean90638/TampermonkeyUserscripts/raw/main/src/google-translate-smart-paste.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG_KEYS = {
        clearExistingOnPaste: 'clearExistingOnPaste',
        autoTextTargetByContent: 'autoTextTargetByContent',
        forceImageDetectToZhTw: 'forceImageDetectToZhTw',
    };
    const DOUBLE_ESCAPE_WINDOW_MS = 500;
    const TOAST_DURATION_MS = 2600;
    const SETTINGS = {
        clearExistingOnPaste: GM_getValue(CONFIG_KEYS.clearExistingOnPaste, true),
        autoTextTargetByContent: GM_getValue(CONFIG_KEYS.autoTextTargetByContent, true),
        forceImageDetectToZhTw: GM_getValue(CONFIG_KEYS.forceImageDetectToZhTw, true),
    };

    let menuCommandIds = [];
    let lastEscapeAt = 0;
    let toastTimerId = 0;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function isVisible(element) {
        return !!element && element.getClientRects().length > 0;
    }

    function elementLabel(element) {
        return (element?.getAttribute('aria-label') || element?.textContent || '').trim();
    }

    function includesKeyword(label, keywords) {
        return keywords.some(keyword => label.includes(keyword));
    }

    function currentMode() {
        return new URL(location.href).searchParams.get('op') === 'images' ? 'images' : 'text';
    }

    function ensureToastElement() {
        let toast = document.getElementById('gt-smart-paste-toast');
        if (toast) {
            return toast;
        }

        toast = document.createElement('div');
        toast.id = 'gt-smart-paste-toast';
        toast.style.position = 'fixed';
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.zIndex = '2147483647';
        toast.style.maxWidth = '320px';
        toast.style.padding = '12px 14px';
        toast.style.borderRadius = '12px';
        toast.style.background = 'rgba(32, 33, 36, 0.94)';
        toast.style.color = '#fff';
        toast.style.fontSize = '14px';
        toast.style.lineHeight = '1.45';
        toast.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.28)';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        toast.style.transition = 'opacity 160ms ease, transform 160ms ease';
        toast.style.pointerEvents = 'none';
        document.body.appendChild(toast);
        return toast;
    }

    function showToast(message, duration = TOAST_DURATION_MS) {
        const toast = ensureToastElement();
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';

        if (toastTimerId) {
            globalThis.clearTimeout(toastTimerId);
        }

        toastTimerId = globalThis.setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
        }, duration);
    }

    async function waitFor(getter, timeout = 2000, interval = 50) {
        const endTime = Date.now() + timeout;
        while (Date.now() < endTime) {
            const result = getter();
            if (result) {
                return result;
            }
            await sleep(interval);
        }
        return null;
    }

    function setSetting(key, value, toastMessage) {
        SETTINGS[key] = value;
        GM_setValue(CONFIG_KEYS[key], value);
        registerMenuCommands();
        showToast(toastMessage);
    }

    function registerMenuCommands() {
        if (typeof GM_unregisterMenuCommand === 'function' && menuCommandIds.length > 0) {
            for (const commandId of menuCommandIds) {
                try {
                    GM_unregisterMenuCommand(commandId);
                } catch {
                    // Tampermonkey 某些版本不支援解除也不影響功能
                }
            }
        }

        menuCommandIds = [
            GM_registerMenuCommand(
                `貼上前清除既有內容：${SETTINGS.clearExistingOnPaste ? '開啟' : '關閉'}`,
                () => {
                    const nextValue = !SETTINGS.clearExistingOnPaste;
                    setSetting('clearExistingOnPaste', nextValue, `貼上前清除既有內容：${nextValue ? '開啟' : '關閉'}`);
                    console.info('[智慧貼上] 貼上前清除既有內容：', SETTINGS.clearExistingOnPaste ? '開啟' : '關閉');
                }
            ),
            GM_registerMenuCommand(
                `文字模式自動切換目標語言：${SETTINGS.autoTextTargetByContent ? '開啟' : '關閉'}`,
                () => {
                    const nextValue = !SETTINGS.autoTextTargetByContent;
                    setSetting('autoTextTargetByContent', nextValue, `文字模式自動切換目標語言：${nextValue ? '開啟' : '關閉'}`);
                    console.info('[智慧貼上] 文字模式自動切換目標語言：', SETTINGS.autoTextTargetByContent ? '開啟' : '關閉');
                }
            ),
            GM_registerMenuCommand(
                `圖片模式固定偵測語言 → 中文(繁體)：${SETTINGS.forceImageDetectToZhTw ? '開啟' : '關閉'}`,
                () => {
                    const nextValue = !SETTINGS.forceImageDetectToZhTw;
                    setSetting('forceImageDetectToZhTw', nextValue, `圖片模式固定偵測語言 → 中文(繁體)：${nextValue ? '開啟' : '關閉'}`);
                    console.info('[智慧貼上] 圖片模式固定偵測語言 → 中文(繁體)：', SETTINGS.forceImageDetectToZhTw ? '開啟' : '關閉');
                }
            ),
        ];
    }

    function findButton(keywords, visibleOnly = false) {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const button of buttons) {
            if (visibleOnly && !isVisible(button)) {
                continue;
            }

            const label = elementLabel(button);
            if (includesKeyword(label, keywords)) {
                return button;
            }
        }
        return null;
    }

    function findTranslateTypeButton(keywords) {
        const candidates = document.querySelectorAll('button[aria-label], nav button, [role="tab"]');
        for (const element of candidates) {
            const label = elementLabel(element);
            if (includesKeyword(label, keywords)) {
                return element;
            }
        }
        return null;
    }

    function findImageTypeButton() {
        return findTranslateTypeButton(['圖片翻譯', '圖片', 'Image']);
    }

    function findTextTypeButton() {
        return findTranslateTypeButton(['文字翻譯', '文字', 'Text']);
    }

    function findVisibleLanguageTablists() {
        return Array.from(document.querySelectorAll('[role="tablist"]')).filter(tablist => {
            return isVisible(tablist) && Array.from(tablist.querySelectorAll('[role="tab"]')).some(isVisible);
        }).slice(0, 2);
    }

    function findTabInTablist(tablist, keywords) {
        if (!tablist) {
            return null;
        }

        return Array.from(tablist.querySelectorAll('[role="tab"]')).find(tab => {
            return isVisible(tab) && includesKeyword(elementLabel(tab), keywords);
        }) || null;
    }

    function findSelectedTab(tablist) {
        if (!tablist) {
            return null;
        }

        return Array.from(tablist.querySelectorAll('[role="tab"][aria-selected="true"]')).find(isVisible) || null;
    }

    function findSourceTextarea(visibleOnly = false) {
        const candidates = document.querySelectorAll('textarea[aria-label], textarea');
        for (const textarea of candidates) {
            if (visibleOnly && !isVisible(textarea)) {
                continue;
            }

            const label = elementLabel(textarea);
            if (!label || includesKeyword(label, ['原文內容', 'Source text'])) {
                return textarea;
            }
        }
        return null;
    }

    function findPasteImageButton(visibleOnly = false) {
        return findButton([
            '貼上剪貼簿中的圖片',
            '從剪貼簿貼上',
            'Paste image from clipboard',
            'Paste from clipboard',
        ], visibleOnly);
    }

    function findClearImageButton(visibleOnly = false) {
        return findButton([
            '清除圖片',
            '移除圖片',
            'Clear image',
            'Remove image',
        ], visibleOnly);
    }

    function findClearTextButton(visibleOnly = false) {
        return findButton([
            '清除原文內容',
            '清除文字',
            'Clear source text',
            'Clear text',
        ], visibleOnly);
    }

    function clickElement(element) {
        if (!element) {
            return false;
        }

        try {
            element.focus?.({ preventScroll: true });
        } catch {
            // 忽略 focus 失敗
        }

        element.click();
        return true;
    }

    async function selectTabIfNeeded(tablist, keywords) {
        const selectedTab = findSelectedTab(tablist);
        if (selectedTab && includesKeyword(elementLabel(selectedTab), keywords)) {
            return true;
        }

        const targetTab = findTabInTablist(tablist, keywords);
        if (!targetTab) {
            return false;
        }

        clickElement(targetTab);
        await sleep(120);
        return true;
    }

    async function waitForSourceTextarea() {
        return waitFor(() => findSourceTextarea(true));
    }

    async function waitForVisiblePasteImageButton() {
        return waitFor(() => findPasteImageButton(true));
    }

    async function waitForMode(mode) {
        return waitFor(() => currentMode() === mode);
    }

    async function waitForVisibleLanguageTablists() {
        return waitFor(() => {
            const tablists = findVisibleLanguageTablists();
            return tablists.length >= 2 ? tablists : null;
        });
    }

    function setSourceText(textarea, nextValue) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

        if (nativeSetter) {
            nativeSetter.call(textarea, nextValue);
        } else {
            textarea.value = nextValue;
        }

        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function detectPreferredTextTarget(text) {
        const normalizedText = text.trim();
        if (!normalizedText) {
            return null;
        }

        const latinCount = (normalizedText.match(/[A-Za-z]/g) || []).length;
        const chineseCount = (normalizedText.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) || []).length;
        const measurableCount = latinCount + chineseCount;

        if (measurableCount < 2) {
            return null;
        }

        if (latinCount >= 3 && latinCount / measurableCount >= 0.6) {
            return 'zh-TW';
        }

        if (chineseCount >= 2 && chineseCount / measurableCount >= 0.25) {
            return 'en';
        }

        return null;
    }

    async function applyTextLanguagePreference(text) {
        if (!SETTINGS.autoTextTargetByContent) {
            return;
        }

        const preferredTarget = detectPreferredTextTarget(text);
        if (!preferredTarget) {
            return;
        }

        const tablists = await waitForVisibleLanguageTablists();
        if (!tablists) {
            return;
        }

        const [sourceTablist, targetTablist] = tablists;
        await selectTabIfNeeded(sourceTablist, ['偵測語言', 'Detect language']);

        if (preferredTarget === 'zh-TW') {
            await selectTabIfNeeded(targetTablist, ['中文 (繁體)', 'Chinese (Traditional)']);
            return;
        }

        await selectTabIfNeeded(targetTablist, ['英文', 'English']);
    }

    async function applyImageLanguagePreference() {
        if (!SETTINGS.forceImageDetectToZhTw) {
            return;
        }

        const tablists = await waitForVisibleLanguageTablists();
        if (!tablists) {
            return;
        }

        const [sourceTablist, targetTablist] = tablists;
        await selectTabIfNeeded(sourceTablist, ['偵測語言', 'Detect language']);
        await selectTabIfNeeded(targetTablist, ['中文 (繁體)', 'Chinese (Traditional)']);
    }

    function isSourceTarget(target) {
        return target instanceof HTMLTextAreaElement && includesKeyword(elementLabel(target), ['原文內容', 'Source text']);
    }

    function shouldIgnoreTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        if (isSourceTarget(target)) {
            return false;
        }

        if (target instanceof HTMLInputElement && target.type !== 'file') {
            return true;
        }

        return !!target.closest('[contenteditable="true"], [contenteditable=""]');
    }

    async function clearCurrentImage() {
        const clearButton = findClearImageButton(true);
        if (!clearButton) {
            return false;
        }

        clickElement(clearButton);
        return !!(await waitForVisiblePasteImageButton());
    }

    async function clearCurrentText() {
        const textarea = await waitForSourceTextarea();
        if (!textarea) {
            return false;
        }

        clickElement(findClearTextButton(true));
        setSourceText(textarea, '');
        return true;
    }

    async function clearCurrentContent() {
        if (currentMode() === 'images') {
            return clearCurrentImage();
        }

        return clearCurrentText();
    }

    async function handleImagePaste(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (currentMode() !== 'images') {
            clickElement(findImageTypeButton());
            await waitForMode('images');
        }

        await applyImageLanguagePreference();

        const hasExistingImage = !!findClearImageButton(true);
        if (hasExistingImage) {
            if (!SETTINGS.clearExistingOnPaste) {
                showToast('目前已有圖片，且已關閉「貼上前清除既有內容」，這次不會替換圖片。');
                console.info('[智慧貼上] 目前已有圖片，且已關閉「貼上前清除既有內容」，因此不會替換。');
                return;
            }

            await clearCurrentImage();
        }

        const pasteButton = await waitForVisiblePasteImageButton();
        if (!clickElement(pasteButton)) {
            showToast('找不到圖片貼上按鈕，請重新整理頁面後再試一次。', 3200);
            console.warn('[智慧貼上] 找不到圖片貼上按鈕，請確認 Google 翻譯頁面結構是否變更。');
        }
    }

    async function handleTextPaste(event, text) {
        const inTextMode = currentMode() === 'text';
        const sourceTarget = isSourceTarget(event.target);
        const shouldReplace = SETTINGS.clearExistingOnPaste;
        const shouldHandleManually = !inTextMode || shouldReplace || !sourceTarget;

        if (!shouldHandleManually) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (!inTextMode) {
            clickElement(findTextTypeButton());
            await waitForMode('text');
        }

        await applyTextLanguagePreference(text);

        const textarea = await waitForSourceTextarea();
        if (!textarea) {
            showToast('找不到文字輸入框，請重新整理頁面後再試一次。', 3200);
            console.warn('[智慧貼上] 找不到文字輸入框。');
            return;
        }

        const currentValue = textarea.value || '';
        const nextValue = shouldReplace ? text : `${currentValue}${text}`;

        textarea.focus();
        setSourceText(textarea, nextValue);
    }

    async function extractText(item) {
        return new Promise(resolve => item.getAsString(resolve));
    }

    registerMenuCommands();

    document.addEventListener('paste', async event => {
        if (shouldIgnoreTarget(event.target)) {
            return;
        }

        const items = Array.from(event.clipboardData?.items || []);
        if (items.length === 0) {
            return;
        }

        const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
        if (imageItem) {
            await handleImagePaste(event);
            return;
        }

        const textItem = items.find(item => item.kind === 'string' && item.type === 'text/plain');
        if (!textItem) {
            return;
        }

        const text = await extractText(textItem);
        await handleTextPaste(event, text);
    }, true);

    document.addEventListener('keydown', async event => {
        if (event.key !== 'Escape') {
            return;
        }

        if (shouldIgnoreTarget(event.target)) {
            return;
        }

        const now = Date.now();
        const isDoubleEscape = now - lastEscapeAt <= DOUBLE_ESCAPE_WINDOW_MS;
        lastEscapeAt = now;

        if (!isDoubleEscape) {
            return;
        }

        const cleared = await clearCurrentContent();
        if (cleared) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
    }, true);

    console.info('[Google 翻譯智慧貼上 v1.6.0] 已載入，設定：', SETTINGS);
})();
