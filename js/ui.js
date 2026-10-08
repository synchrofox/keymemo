export function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

export function syncMobileLayout(els, isNativeSupported) {
    if (!els.btnMobileToggle || !els.txtSaveBtn || !els.txtLockBtn || !els.appTitleText) return;
    if (!isMobileViewport()) {
        els.appScreen.classList.remove('mobile-preview');
        els.btnMobileToggle.textContent = 'プレビュー';
        els.txtSaveBtn.textContent = isNativeSupported ? '上書き保存' : '暗号化保存';
        els.txtLockBtn.textContent = 'ロック';
        els.appTitleText.textContent = 'KeyMemo';
        return;
    }
    const isPreviewMode = els.appScreen.classList.contains('mobile-preview');
    els.btnMobileToggle.textContent = isPreviewMode ? '編集' : '表示';
    els.txtSaveBtn.textContent = '保存';
    els.txtLockBtn.textContent = 'ロック';
    els.appTitleText.textContent = 'KM';
}

export function checkPasswordStrength(password) {
    if (!password) return { score: 0, label: '', color: 'bg-slate-400', width: 'w-0' };

    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 20) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;
    if (/(.)\1{3,}/.test(password)) score -= 1;

    score = Math.max(0, Math.min(4, score));
    const levels = [
        { label: '', color: 'bg-slate-400', width: 'w-0' },
        { label: '弱い', color: 'bg-red-500', width: 'w-1/4' },
        { label: '普通', color: 'bg-yellow-500', width: 'w-2/4' },
        { label: '強い', color: 'bg-blue-500', width: 'w-3/4' },
        { label: '非常に強い', color: 'bg-green-500', width: 'w-full' }
    ];

    return { score, label: levels[score].label, color: levels[score].color, width: levels[score].width };
}

export function updatePasswordStrengthUI(els, strength) {
    if (els.pwdStrengthFill) {
        els.pwdStrengthFill.className = `h-full ${strength.color} ${strength.width} rounded-full transition-all duration-300`;
    }
    if (els.pwdStrengthText) {
        els.pwdStrengthText.textContent = strength.label;
        els.pwdStrengthText.className = `text-xs font-medium ${strength.score <= 1 ? 'text-red-500' :
            strength.score === 2 ? 'text-yellow-600' :
                strength.score === 3 ? 'text-blue-600' :
                    'text-green-600'
            }`;
    }
    if (els.masterPassword) {
        els.masterPassword.classList.toggle('border-red-400', strength.score <= 1);
        els.masterPassword.classList.toggle('border-yellow-400', strength.score === 2);
        els.masterPassword.classList.toggle('border-green-400', strength.score >= 3);
        els.masterPassword.classList.toggle('border-slate-300', strength.score === 0);
    }
}

export function createToast(toastContainer) {
    return function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        const bgColor = type === 'success' ? 'bg-slate-800' : 'bg-red-600';
        toast.className = `${bgColor} text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium toast-enter flex items-center gap-2`;
        toast.innerHTML = type === 'success'
            ? '<svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
            : '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        toast.append(document.createTextNode(message));
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0'; toast.style.transform = 'translateY(100%)'; toast.style.transition = 'all 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };
}

export function createPreviewUpdater(preview) {
    return function updatePreview(text) {
        const rawHtml = marked.parse(text);
        if (window.DOMPurify) {
            preview.innerHTML = window.DOMPurify.sanitize(rawHtml);
        } else {
            preview.textContent = text;
        }

        if (window.Prism) {
            Prism.highlightAllUnder(preview);
        }
    };
}

export function setupScrollSync(editorEl, previewEl, button, onToggle) {
    let enabled = true;
    let isScrolling = false;

    function updateUI() {
        if (!button) return;
        const iconOff = button.querySelector('.sync-icon-off');
        const iconOn = button.querySelector('.sync-icon-on');
        if (enabled) {
            iconOff.classList.add('hidden');
            iconOn.classList.remove('hidden');
            button.classList.remove('text-indigo-600', 'bg-indigo-50', 'border-indigo-200');
            button.classList.add('text-white', 'bg-indigo-600', 'border-transparent');
        } else {
            iconOff.classList.remove('hidden');
            iconOn.classList.add('hidden');
            button.classList.remove('text-white', 'bg-indigo-600', 'border-transparent');
            button.classList.add('text-indigo-600', 'bg-indigo-50', 'border-indigo-200');
        }
    }

    function sync(source, target) {
        if (!enabled || isScrolling) return;
        isScrolling = true;

        const maxScrollTop = source.scrollHeight - source.clientHeight;
        if (maxScrollTop <= 0) {
            isScrolling = false;
            return;
        }

        const scrollRatio = source.scrollTop / maxScrollTop;
        target.scrollTop = scrollRatio * (target.scrollHeight - target.clientHeight);
        setTimeout(() => { isScrolling = false; }, 10);
    }

    editorEl.addEventListener('scroll', () => sync(editorEl, previewEl), { passive: true });
    previewEl.addEventListener('scroll', () => sync(previewEl, editorEl), { passive: true });
    if (button) {
        button.addEventListener('click', () => {
            enabled = !enabled;
            updateUI();
            onToggle(enabled);
        });
    }
    updateUI();
}