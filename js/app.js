import { encryptAndPackData, SALT_LENGTH, unpackAndDecryptData } from './crypto.js';
import { checkPasswordStrength, createPreviewUpdater, createToast, isMobileViewport, setupScrollSync, syncMobileLayout, updatePasswordStrengthUI } from './ui.js';

(function () {
    // === State Variables ===
    let currentPassword = null;
    let currentSalt = null;         // Uint8Array(16)
    let pendingFileBuffer = null;   // 復号待ちのバッファ
    let hasSelectedFileForDecryption = false;
    let currentFileHandle = null;  // File System Access API 用のファイルハンドル
    let currentDocumentId = null;
    let isNativeSupported = false;  // APIが完全に利用可能かどうかのフラグ
    let hasUnsavedChanges = false;
    let editorRevision = 0;
    let activeDocumentRevision = 0;
    let sessionBackupRevision = 0;
    let pendingFileReadRevision = 0;
    let pendingSessionBackup = null; // パスワード再入力待ちの暗号化セッション
    function setDirtyState(isDirty) {
        hasUnsavedChanges = isDirty;
        els.dirtyBadge.classList.toggle('hidden', !hasUnsavedChanges);
    }

    const SESSION_BACKUP_KEY = 'keymemo_session_backup_enc';

    // === DOM Elements ===
    const els = {
        lockScreen: document.getElementById('lock-screen'),
        appScreen: document.getElementById('app-screen'),
        dropZone: document.getElementById('drop-zone'),
        dropText: document.getElementById('drop-text'),
        fileInput: document.getElementById('file-input'),
        masterPassword: document.getElementById('master-password'),
        pwdStrengthBar: document.getElementById('pwd-strength-bar'),
        pwdStrengthFill: document.getElementById('pwd-strength-fill'),
        pwdStrengthText: document.getElementById('pwd-strength-text'),
        btnUnlock: document.getElementById('btn-unlock'),
        btnCreateNew: document.getElementById('btn-create-new'),
        apiStatusBadge: document.getElementById('api-status-badge'),

        editor: document.getElementById('editor'),
        preview: document.getElementById('preview'),
        appTitleText: document.getElementById('app-title-text'),
        dirtyBadge: document.getElementById('dirty-badge'),
        statusIndicator: document.getElementById('status-indicator'),
        btnSave: document.getElementById('btn-save'),
        txtSaveBtn: document.getElementById('txt-save-btn'),
        btnSaveAs: document.getElementById('btn-save-as'),
        btnScrollSync: document.getElementById('btn-scroll-sync'),
        txtScrollSyncBtn: document.getElementById('txt-scroll-sync-btn'),
        btnMobileToggle: document.getElementById('btn-mobile-toggle'),
        btnLock: document.getElementById('btn-lock'),
        txtLockBtn: document.getElementById('txt-lock-btn'),
        toastContainer: document.getElementById('toast-container')
    };

    // スクロール同期用のエレメント参照
    const editorPane = document.getElementById('editor-pane');
    const previewPane = document.getElementById('preview-pane');
    const showToast = createToast(els.toastContainer);
    const updatePreview = createPreviewUpdater(els.preview);

    setupScrollSync(els.editor, previewPane, els.btnScrollSync, (enabled) => {
        showToast(enabled ? 'スクロール連動を有効にしました' : 'スクロール連動を無効にしました');
    });

    // === API Availability Check ===
    window.addEventListener('DOMContentLoaded', () => {
        // このアプリが使う読み込み・保存APIの両方を確認
        if (window.showOpenFilePicker && window.showSaveFilePicker && window.isSecureContext) {
            isNativeSupported = true;
            els.apiStatusBadge.textContent = 'Native API モード (直接上書き可能)';
            els.apiStatusBadge.classList.add('bg-green-100', 'text-green-700');
            els.txtSaveBtn.textContent = '上書き保存';
        } else {
            isNativeSupported = false;
            els.apiStatusBadge.textContent = 'ブラウザ制限モード (毎回ダウンロード方式)';
            els.apiStatusBadge.classList.add('bg-amber-100', 'text-amber-700');
            els.txtSaveBtn.textContent = '暗号化保存';
        }
        restoreSession();
        syncMobileLayout(els, isNativeSupported);
    });

    // === Session Storage Management (リロード対策用一時退避) ===
    function uint8ArrayToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function createDocumentId() {
        return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function getDocumentId(encryptedData) {
        const digest = await crypto.subtle.digest('SHA-256', encryptedData);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function saveSession() {
        if (!currentPassword) return;

        // 未保存変更がない場合はバックアップを残さない
        if (!hasUnsavedChanges) {
            clearSession();
            return;
        }

        const backupRevision = ++sessionBackupRevision;
        const password = currentPassword;
        const salt = currentSalt;
        const documentId = currentDocumentId;
        const revision = editorRevision;
        const sessionPayload = {
            content: els.editor.value,
            currentSalt: Array.from(currentSalt),
            documentId
        };

        try {
            const payloadText = JSON.stringify(sessionPayload);
            const packed = await encryptAndPackData(payloadText, password, salt);
            const encoded = uint8ArrayToBase64(packed);
            if (backupRevision !== sessionBackupRevision || revision !== editorRevision ||
                password !== currentPassword || documentId !== currentDocumentId) return;
            sessionStorage.setItem(SESSION_BACKUP_KEY, encoded);
            pendingSessionBackup = encoded;
            updateStatus('✓ セッションを暗号化バックアップ済み');
        } catch (e) {
            console.error(e);
            showToast('セッションバックアップに失敗しました', 'error');
        }
    }

    async function tryRestoreSessionBackup(password, expectedDocumentId = null) {
        if (!pendingSessionBackup) return { restored: false };
        try {
            const packed = base64ToUint8Array(pendingSessionBackup);
            const { text } = await unpackAndDecryptData(packed.buffer, password);
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed.content !== 'string') {
                throw new Error('セッションデータ形式が不正です');
            }

            const backupMatchesDocument = expectedDocumentId === null || parsed.documentId === expectedDocumentId;
            const restoreAsSeparateDocument = !backupMatchesDocument && window.confirm(
                '別の文書の暗号化バックアップがあります。\nOK: バックアップを別文書として復元\nキャンセル: バックアップを破棄して選択中の文書を開く'
            );
            if (!backupMatchesDocument && !restoreAsSeparateDocument) {
                clearSession();
                return { restored: false };
            }

            els.editor.value = parsed.content;
            updatePreview(parsed.content);
            setDirtyState(true);
            if (Array.isArray(parsed.currentSalt) && parsed.currentSalt.length === SALT_LENGTH) {
                currentSalt = new Uint8Array(parsed.currentSalt);
            }
            if (restoreAsSeparateDocument) {
                currentFileHandle = null;
                pendingFileBuffer = null;
            }
            currentDocumentId = parsed.documentId || expectedDocumentId || createDocumentId();
            pendingSessionBackup = null;
            showToast('暗号化セッションを復元しました');
            return { restored: true, restoredAsSeparateDocument: restoreAsSeparateDocument };
        } catch (e) {
            const shouldDiscard = expectedDocumentId !== null && window.confirm(
                'セッションバックアップを復号できませんでした。別のパスワードか、破損の可能性があります。\nOK: バックアップを破棄して選択中の文書を開く\nキャンセル: 文書を開かず戻る'
            );
            if (shouldDiscard) {
                clearSession();
                return { restored: false, discardedUnreadableBackup: true };
            }
            return { restored: false, cancelled: expectedDocumentId !== null };
        }
    }

    function restoreSession() {
        const raw = sessionStorage.getItem(SESSION_BACKUP_KEY);
        if (raw) {
            pendingSessionBackup = raw;
            els.dropText.innerHTML = `暗号化バックアップを検出<br><span class="text-xs text-slate-400">ファイル再選択なしで復元できます（パスワード入力後にロック解除）</span>`;
            showToast('暗号化バックアップを検出。パスワード入力後に復元します');
        }
    }

    function clearSession() {
        sessionBackupRevision++;
        sessionStorage.removeItem(SESSION_BACKUP_KEY);
        sessionStorage.removeItem('keymemo_session_data');
        pendingSessionBackup = null;
    }

    function updateStatus(text) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('ja-JP', { hour12: false });
        const fileInfo = currentFileHandle ? `[${currentFileHandle.name}]` : '[新規のメモ]';
        els.statusIndicator.textContent = text;
        els.statusIndicator.title = `${fileInfo} ${text} (${timeString})`;
    }

    // パスワード強度リアルタイムチェック
    els.masterPassword.addEventListener('input', () => {
        if (hasSelectedFileForDecryption) return;
        const strength = checkPasswordStrength(els.masterPassword.value);
        updatePasswordStrengthUI(els, strength);
    });

    function setPasswordStrengthVisible(isVisible) {
        els.pwdStrengthBar.parentElement.classList.toggle('hidden', !isVisible);
        if (!isVisible) updatePasswordStrengthUI(els, checkPasswordStrength(''));
    }

    function enterApp() {
        els.masterPassword.value = '';
        pendingFileBuffer = null;
        els.dropText.innerHTML = `.keymemo ファイルをドロップ<br><span class="text-xs text-slate-400">またはクリックしてファイルを選択</span>`;
        els.lockScreen.classList.add('hidden');
        els.appScreen.classList.remove('hidden');
        syncMobileLayout(els, isNativeSupported);
    }

    function showSelectedFile(fileName, description) {
        const name = document.createElement('span');
        name.className = 'text-blue-600 font-bold';
        name.textContent = fileName;
        const detail = document.createElement('span');
        detail.className = 'text-xs text-slate-400';
        detail.textContent = description;
        els.dropText.replaceChildren(name, document.createElement('br'), detail);
    }

    // === Event Handlers (Lock Screen) ===

    // 1. 従来のドラッグ＆ドロップおよびファイル入力
    els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.classList.add('bg-slate-50', 'border-blue-400'); });
    els.dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); els.dropZone.classList.remove('bg-slate-50', 'border-blue-400'); });
    els.dropZone.addEventListener('drop', (e) => { e.preventDefault(); els.dropZone.classList.remove('bg-slate-50', 'border-blue-400'); if (e.dataTransfer.files.length > 0) handleLegacyFile(e.dataTransfer.files[0]); });
    els.dropZone.addEventListener('click', async () => {
        if (isNativeSupported) {
            await openNativeFile();
            return;
        }
        els.fileInput.click();
    });
    els.fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleLegacyFile(e.target.files[0]); });

    function handleLegacyFile(file) {
        const readRevision = ++pendingFileReadRevision;
        hasSelectedFileForDecryption = true;
        setPasswordStrengthVisible(false);
        currentFileHandle = null; // 従来方式のためハンドルは無し
        pendingFileBuffer = null;
        showSelectedFile(file.name, 'ロード準備完了 (復号パスワードを入力してください)');
        const reader = new FileReader();
        reader.onload = (e) => {
            if (readRevision === pendingFileReadRevision) pendingFileBuffer = e.target.result;
        };
        reader.readAsArrayBuffer(file);
    }

    // 2. File System Access API を使ったファイルオープン
    async function openNativeFile() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'KeyMemo Encrypted Files', accept: { 'application/octet-stream': ['.keymemo'] } }]
            });
            const readRevision = ++pendingFileReadRevision;
            hasSelectedFileForDecryption = true;
            setPasswordStrengthVisible(false);
            currentFileHandle = handle;
            pendingFileBuffer = null;
            const file = await handle.getFile();
            if (readRevision !== pendingFileReadRevision) return;
            showSelectedFile(file.name, 'システム連携完了 (復号パスワードを入力してください)');

            const buffer = await file.arrayBuffer();
            if (readRevision !== pendingFileReadRevision) return;
            pendingFileBuffer = buffer;
        } catch (e) {
            console.log('File picker canceled');
        }
    }

    // 3. ロック解除（復号実行）
    els.btnUnlock.addEventListener('click', async () => {
        const pwd = els.masterPassword.value;
        if (!pwd) return showToast('パスワードを入力してください', 'error');

        // リロード後は、暗号化セッションバックアップのみで復元可能にする
        if (!pendingFileBuffer && pendingSessionBackup) {
            try {
                currentPassword = pwd;
                const restoreResult = await tryRestoreSessionBackup(pwd);
                if (!restoreResult.restored) {
                    currentPassword = null;
                    return showToast('パスワードが違うか、バックアップの復元に失敗しました', 'error');
                }
                setDirtyState(true);
                void saveSession();
                enterApp();
                updateStatus('✓ 暗号化バックアップから復元しました');
                return;
            } catch (e) {
                currentPassword = null;
                return showToast('バックアップ復元中にエラーが発生しました', 'error');
            }
        }

        if (!pendingFileBuffer) return showToast('ファイルを選択または投入してください', 'error');

        try {
            const documentId = await getDocumentId(pendingFileBuffer);
            const { text, salt } = await unpackAndDecryptData(pendingFileBuffer, pwd);
            currentPassword = pwd;
            currentSalt = salt;
            currentDocumentId = documentId;
            els.editor.value = text;
            updatePreview(text);
            const restoreResult = await tryRestoreSessionBackup(pwd, documentId);
            if (restoreResult.cancelled) {
                currentPassword = null;
                currentSalt = null;
                currentDocumentId = null;
                els.editor.value = '';
                updatePreview('');
                return;
            }
            setDirtyState(restoreResult.restored);
            void saveSession();
            enterApp();
            if (restoreResult.restoredAsSeparateDocument) {
                showToast('バックアップを別文書として復元しました');
                updateStatus('✓ 暗号化バックアップから復元しました');
            } else {
                showToast('ロック解除に成功しました');
                updateStatus('✓ ファイルを正常に復号しました');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // 4. 新規作成
    els.btnCreateNew.addEventListener('click', async () => {
        const pwd = els.masterPassword.value;
        if (!pwd) return showToast('暗号化用のパスワードを設定してください', 'error');

        // 弱いパスワードの警告
        const strength = checkPasswordStrength(pwd);
        if (strength.score <= 1) {
            const confirmWeak = window.confirm('パスワードの強度が低いです。より強力なパスワードの使用を推奨します。続行しますか？');
            if (!confirmWeak) return;
        }

        currentPassword = pwd;
        currentSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        currentDocumentId = createDocumentId();
        currentFileHandle = null;
        els.editor.value = '';
        updatePreview('');
        const restoreResult = await tryRestoreSessionBackup(pwd, currentDocumentId);
        if (restoreResult.cancelled) {
            currentPassword = null;
            currentSalt = null;
            currentDocumentId = null;
            return;
        }
        setDirtyState(true);

        void saveSession();
        enterApp();
        showToast('新規暗号化メモを作成しました');
        updateStatus('新規ドキュメント');
    });

    // === Event Handlers (Editor Area) ===
    let typingTimer;
    els.editor.addEventListener('input', (e) => {
        editorRevision++;
        sessionBackupRevision++;
        updatePreview(e.target.value);
        setDirtyState(true);
        // タイピング停止から1秒後にsessionStorageへ自動バックアップ（リロード対策）
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { void saveSession(); }, 1000);
    });

    // === Saving & Exporting Logic ===

    // メインの保存処理 (コアロジック)
    async function saveDocument(isSaveAs = false) {
        if (!currentPassword) return;
        const content = els.editor.value;
        const password = currentPassword;
        const salt = currentSalt;
        const revision = editorRevision;
        const activeRevision = activeDocumentRevision;

        try {
            const packedBinary = await encryptAndPackData(content, password, salt);
            if (activeRevision !== activeDocumentRevision || currentPassword !== password) return;

            // A. Native API による直接書き込み（上書き、または新規名前を付けて保存）
            if (isNativeSupported) {
                if (!currentFileHandle || isSaveAs) {
                    currentFileHandle = await window.showSaveFilePicker({
                        suggestedName: `memo_${new Date().toISOString().split('T')[0]}.keymemo`,
                        types: [{ description: 'KeyMemo Encrypted Files', accept: { 'application/octet-stream': ['.keymemo'] } }]
                    });
                }
                if (activeRevision !== activeDocumentRevision || currentPassword !== password) return;
                const writable = await currentFileHandle.createWritable();
                await writable.write(packedBinary);
                await writable.close();
            }
            // B. 非対応環境によるブラウザダウンロードフォールバック
            else {
                const blob = new Blob([packedBinary], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = currentFileHandle ? currentFileHandle.name : `memo_${new Date().toISOString().split('T')[0]}.keymemo`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
            }
            if (activeRevision !== activeDocumentRevision || currentPassword !== password) return;
            const savedDocumentId = await getDocumentId(packedBinary);
            if (activeRevision !== activeDocumentRevision || currentPassword !== password) return;
            currentDocumentId = savedDocumentId;
            const savedWithoutFurtherEdits = editorRevision === revision;
            setDirtyState(!savedWithoutFurtherEdits);
            if (isNativeSupported) {
                showToast(`${currentFileHandle.name} に直接上書き保存しました`);
                updateStatus('✓ ディスクに直接保存完了');
            } else {
                showToast('暗号化ファイルをダウンロードしました');
                updateStatus('✓ エクスポート完了 (要手動置き換え)');
            }
            void saveSession(); // バックアップも更新
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                showToast('保存中にエラーが発生しました', 'error');
            }
        }
    }

    // ボタンクリックイベント
    els.btnSave.addEventListener('click', () => saveDocument(false));
    els.btnSaveAs.addEventListener('click', () => saveDocument(true));
    els.btnMobileToggle.addEventListener('click', () => {
        if (!isMobileViewport()) return;
        els.appScreen.classList.toggle('mobile-preview');
        syncMobileLayout(els, isNativeSupported);
    });
    window.addEventListener('resize', () => syncMobileLayout(els, isNativeSupported));

    // ショートカットキー (Ctrl + S / Cmd + S) のバインド
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault(); // ブラウザ標準の保存ダイアログを防止
            if (!els.appScreen.classList.contains('hidden')) {
                saveDocument(false);
            }
        }
    });

    window.addEventListener('beforeunload', (e) => {
        if (!hasUnsavedChanges || els.appScreen.classList.contains('hidden')) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // === ロック（安全な破棄） ===
    els.btnLock.addEventListener('click', () => {
        if (hasUnsavedChanges) {
            const shouldDiscard = window.confirm('未保存の変更があります。保存せずにロックしますか？');
            if (!shouldDiscard) return;
        }

        activeDocumentRevision++;
        editorRevision++;

        // メモリ上の機密データを完全にクリア
        els.editor.value = '';
        updatePreview('');
        currentPassword = null;
        currentSalt = null;
        pendingFileBuffer = null;
        pendingFileReadRevision++;
        currentFileHandle = null;
        currentDocumentId = null;
        setDirtyState(false);
        els.masterPassword.value = '';
        hasSelectedFileForDecryption = false;
        updatePasswordStrengthUI(els, checkPasswordStrength(''));
        setPasswordStrengthVisible(true);

        clearSession(); // sessionStorageも完全削除

        els.appScreen.classList.add('hidden');
        els.lockScreen.classList.remove('hidden');
        showToast('セッションを閉じ、データを安全に破棄しました');
    });

})();
