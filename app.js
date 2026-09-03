const STORAGE_KEY = 'povo-code-manager-v1';
const POVO_PACKAGE = 'com.kddi.kdla.jp';

// プロモコード入力画面へ直接飛ぶための候補。上から順に試し、
// 開けたものを povoTargetLastOk に覚えて次回から最優先で使う。
// 最後は必ずネイティブ側で通常起動（launcher）にフォールバックする。
const POVO_TARGET_CANDIDATES = [
  'povo://promocode',
  'povo://promo_code',
  'povo://promotion_code',
  'povo://coupon',
  'https://kddi-povo.app.link/promocode',
  'https://kddi-povo.app.link/promo_code',
  'https://kddi-povo.app.link/dashboard',
];

const state = {
  sets: [],
  activeSetId: null,
  settings: {
    autoOpenApp: true,
    confirmUse: true,
    povoTarget: '',
    povoTargetLastOk: '',
  },
  lastCopiedCode: null,
};

const $ = (id) => document.getElementById(id);

const els = {
  activeSetCard: $('activeSetCard'),
  emptyState: $('emptyState'),
  activeSetName: $('activeSetName'),
  activeSetExpiry: $('activeSetExpiry'),
  activeUseStatus: $('activeUseStatus'),
  lastUseTime: $('lastUseTime'),
  lastValidUntil: $('lastValidUntil'),
  usedCount: $('usedCount'),
  totalCount: $('totalCount'),
  remainingCount: $('remainingCount'),
  progressFill: $('progressFill'),
  useCodeBtn: $('useCodeBtn'),
  useHint: $('useHint'),
  undoBtn: $('undoBtn'),
  copyAgainBtn: $('copyAgainBtn'),
  lastCodeBox: $('lastCodeBox'),
  lastCodeValue: $('lastCodeValue'),
  setList: $('setList'),
  toast: $('toast'),
  addModal: $('addModal'),
  addForm: $('addForm'),
  expiresAt: $('expiresAt'),
  codesInput: $('codesInput'),
  parsedPreview: $('parsedPreview'),
  parsedSummary: $('parsedSummary'),
  parsedCodesList: $('parsedCodesList'),
  maxUsesField: $('maxUsesField'),
  maxUsesInput: $('maxUsesInput'),
  saveSetBtn: $('saveSetBtn'),
  settingsModal: $('settingsModal'),
  settingsSetSection: $('settingsSetSection'),
  settingsValidHours: $('settingsValidHours'),
  settingsValidDays: $('settingsValidDays'),
  settingsExpiresAt: $('settingsExpiresAt'),
  settingsUsed: $('settingsUsed'),
  settingsRemaining: $('settingsRemaining'),
  settingsTotal: $('settingsTotal'),
  autoOpenApp: $('autoOpenApp'),
  confirmUse: $('confirmUse'),
  povoTarget: $('povoTarget'),
  povoTargetStatus: $('povoTargetStatus'),
  povoTargetList: $('povoTargetList'),
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    let migrated = false;

    state.sets = (data.sets || []).map((set) => {
      const normalized = normalizeSet(set);
      if (migrateSetMaxUses(normalized)) migrated = true;
      if (migrateSetLastUse(normalized)) migrated = true;
      return normalized;
    });
    state.activeSetId = data.activeSetId || null;
    state.settings = { ...state.settings, ...data.settings };

    if (migrated) save();
  } catch {
    /* ignore corrupt data */
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sets: state.sets,
    activeSetId: state.activeSetId,
    settings: state.settings,
  }));
}

function showToast(message, duration = 2500) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.remove('show'), duration);
}

function parseDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return {
    iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    display: `${y}/${m}/${d}`,
  };
}

function detectExpiryDate(text) {
  const patterns = [
    /(?:有効期限|入力期限|コード期限|利用期限|期限)\s*[：:は]?\s*(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/,
    /(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?\s*まで/,
    /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseDateParts(match[1], match[2], match[3]);
      if (parsed) return parsed;
    }
  }

  return null;
}

function detectMaxUses(text) {
  const patterns = [
    /(\d{1,3})\s*回分/,
    /(\d{1,3})回分/,
    /(\d{1,3})\s*回(?:利用|使用|使え|まで)?/,
    /(\d{1,3})回(?:利用|使用|使え|まで)?/,
    /[×xX]\s*(\d{1,3})/,
    /(\d{1,3})\s*[×xX]/,
    /(\d{1,3})\s*(?:枚|個|本)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = Number(match[1]);
      if (count >= 2 && count <= 999) return count;
    }
  }

  return null;
}

function parseCodes(text) {
  if (!text?.trim()) return [];

  const candidates = text
    .split(/[\n\r,、\t;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const codes = [];
  const seen = new Set();

  for (const line of candidates) {
    const matches = line.match(/[A-Za-z0-9]{4,}(?:[-\s][A-Za-z0-9]{4,})*/g);
    if (matches) {
      for (const m of matches) {
        const normalized = m.replace(/\s+/g, '-').toUpperCase();
        if (normalized.length >= 8 && !seen.has(normalized)) {
          seen.add(normalized);
          codes.push(normalized);
        }
      }
    }
  }

  return codes;
}

function ensureEntryShape(entry) {
  entry.usedCount = Math.max(0, Number(entry.usedCount) || 0);
  entry.maxUses = Math.max(1, Number(entry.maxUses) || 1);
  return entry;
}

function normalizeCodeEntry(entry) {
  if (typeof entry.usedCount === 'number') {
    return ensureEntryShape({
      code: entry.code,
      usedCount: entry.usedCount,
      maxUses: entry.maxUses || 1,
    });
  }

  return ensureEntryShape({
    code: entry.code,
    usedCount: entry.used ? 1 : 0,
    maxUses: 1,
  });
}

function migrateSetLastUse(set) {
  if (set.lastUse?.usedAt) return false;

  let latest = null;

  (set.codes || []).forEach((entry, codeIndex) => {
    const history = Array.isArray(entry.usedHistory) ? entry.usedHistory : [];
    history.forEach((usedAt) => {
      if (!latest || new Date(usedAt) > new Date(latest.usedAt)) {
        latest = { usedAt, codeIndex };
      }
    });

    if (!history.length && entry.usedAt) {
      if (!latest || new Date(entry.usedAt) > new Date(latest.usedAt)) {
        latest = { usedAt: entry.usedAt, codeIndex };
      }
    }
  });

  if (!latest) return false;

  set.lastUse = latest;
  return true;
}

function getLastUse(set) {
  return set.lastUse?.usedAt ? set.lastUse : null;
}

function inferMaxUsesFromText(...parts) {
  const text = parts.filter(Boolean).join('\n');
  return detectMaxUses(text);
}

function migrateSetMaxUses(set) {
  if (set.codes.length !== 1) return false;

  const entry = set.codes[0];
  if (entry.maxUses > 1) return false;

  const inferred = inferMaxUsesFromText(set.expiresAt);
  if (!inferred || inferred <= 1) return false;

  entry.maxUses = inferred;
  return true;
}

function detectValidHours(text) {
  const patterns = [
    [/(\d+)\s*時間/, (n) => Number(n)],
    [/(\d+)\s*日間?/, (n) => Number(n) * 24],
    [/(\d+)\s*週間?/, (n) => Number(n) * 24 * 7],
  ];

  for (const [pattern, convert] of patterns) {
    const match = text.match(pattern);
    if (match) {
      const hours = convert(match[1]);
      if (hours > 0 && hours <= 24 * 365) return hours;
    }
  }

  return null;
}

function splitValidHours(validHours) {
  const total = Math.max(0, Number(validHours) || 0);
  if (total === 0) return { hours: 24, days: 0 };
  if (total % 24 !== 0) {
    return { hours: total % 24, days: Math.floor(total / 24) };
  }
  if (total < 48) return { hours: total, days: 0 };
  return { hours: 0, days: total / 24 };
}

function combineValidHours(hours, days) {
  const h = Math.max(0, Number(hours) || 0);
  const d = Math.max(0, Number(days) || 0);
  const total = h + d * 24;
  return total > 0 ? total : 24;
}

function formatDateTimeJa(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function getValidUntilText(usedAt, validHours) {
  if (!usedAt || !validHours) return null;

  const until = new Date(new Date(usedAt).getTime() + validHours * 3600000);
  return formatDateTimeJa(until.toISOString());
}

function normalizeSet(set) {
  set.expiresAt = set.expiresAt || '';
  if (!set.validHours) {
    set.validHours = 24;
  }
  if (!set.lastUse) {
    set.lastUse = null;
  }
  set.codes = (set.codes || []).map(normalizeCodeEntry);
  return set;
}

function getSetTitle(set) {
  if (set.expiresAt?.trim()) {
    const parsed = parseExpiryValue(set.expiresAt);
    return `期限 ${parsed?.display || set.expiresAt.trim()}`;
  }
  return `コードセット (${new Date(set.createdAt || Date.now()).toLocaleDateString('ja-JP')})`;
}

function parseExpiryValue(value) {
  if (!value?.trim()) return null;

  const detected = detectExpiryDate(value);
  if (detected) return detected;

  const slashMatch = value.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (slashMatch) {
    return parseDateParts(slashMatch[1], slashMatch[2], slashMatch[3]);
  }

  return { iso: '', display: value.trim() };
}

function getExpiryInfo(set) {
  const parsed = parseExpiryValue(set.expiresAt);
  if (!parsed?.display) {
    return { text: '', status: 'none', daysLeft: null };
  }

  if (!parsed.iso) {
    return { text: `期限: ${parsed.display}`, status: 'unknown', daysLeft: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(parsed.iso);
  expiry.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((expiry - today) / 86400000);

  if (daysLeft < 0) {
    return { text: `期限: ${parsed.display}（期限切れ）`, status: 'expired', daysLeft };
  }
  if (daysLeft <= 7) {
    return { text: `期限: ${parsed.display}（あと${daysLeft}日）`, status: 'soon', daysLeft };
  }

  return { text: `期限: ${parsed.display}`, status: 'ok', daysLeft };
}

function autofillFromPastedText(text) {
  if (!els.expiresAt.value.trim()) {
    const expiry = detectExpiryDate(text);
    if (expiry) els.expiresAt.value = expiry.display;
  }

  const inferredUses = inferMaxUsesFromText(els.expiresAt.value, text);
  if (inferredUses && inferredUses > 1) {
    els.maxUsesInput.value = String(inferredUses);
  }
}

function getRegistrationContextText() {
  return [els.expiresAt.value, els.codesInput.value]
    .filter(Boolean)
    .join('\n');
}

function parseRegistration(codeText, contextText = '') {
  const fullText = `${contextText}\n${codeText}`;
  const codes = parseCodes(codeText);
  const detectedMaxUses = detectMaxUses(fullText);

  if (codes.length === 0) {
    return { codes: [], totalUses: 0, mode: 'none', detectedMaxUses };
  }

  if (codes.length === 1) {
    const maxUses = detectedMaxUses || 1;
    return {
      codes,
      totalUses: maxUses,
      mode: maxUses > 1 ? 'repeat' : 'single',
      detectedMaxUses,
    };
  }

  return {
    codes,
    totalUses: codes.length,
    mode: 'multi',
    detectedMaxUses,
  };
}

function createCodeEntries(codes, maxUses) {
  if (codes.length === 1 && maxUses > 1) {
    return [{ code: codes[0], usedCount: 0, maxUses }];
  }

  return codes.map((code) => ({ code, usedCount: 0, maxUses: 1 }));
}

function getActiveSet() {
  return state.sets.find((s) => s.id === state.activeSetId) || null;
}

function getNextUsableCode(set) {
  return set.codes.find((c) => c.usedCount < c.maxUses) || null;
}

function getSetStats(set) {
  const total = set.codes.reduce((sum, c) => sum + c.maxUses, 0);
  const used = set.codes.reduce((sum, c) => sum + c.usedCount, 0);
  return { total, used, remaining: total - used };
}

function updateUI() {
  const active = getActiveSet();
  const hasSets = state.sets.length > 0;

  els.emptyState.hidden = hasSets;
  els.activeSetCard.hidden = !hasSets;

  if (!hasSets) {
    renderSetList();
    return;
  }

  if (!active) {
    state.activeSetId = state.sets[0].id;
    save();
    return updateUI();
  }

  const stats = getSetStats(active);
  const expiryInfo = getExpiryInfo(active);
  els.activeSetName.textContent = getSetTitle(active);
  els.activeSetExpiry.textContent = expiryInfo.text;
  els.activeSetExpiry.hidden = !expiryInfo.text;
  els.activeSetExpiry.className = `hero-expiry${expiryInfo.status === 'soon' ? ' soon' : ''}${expiryInfo.status === 'expired' ? ' expired' : ''}`;
  els.usedCount.textContent = stats.used;
  els.totalCount.textContent = stats.total;
  els.remainingCount.textContent = stats.remaining;

  const pct = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;
  els.progressFill.style.width = `${pct}%`;

  const next = getNextUsableCode(active);
  els.useCodeBtn.disabled = !next;
  const isRepeatCode = next && next.maxUses > 1;
  els.useHint.textContent = next
    ? isRepeatCode
      ? `同じコードをコピーします（残り ${next.maxUses - next.usedCount} 回）`
      : 'タップでクリップボードにコピーし、POVOアプリを開きます'
    : 'すべてのコードを使い切りました 🎉';

  els.undoBtn.disabled = !getLastUse(active);

  if (state.lastCopiedCode) {
    els.lastCodeBox.hidden = false;
    els.lastCodeValue.textContent = state.lastCopiedCode;
  }

  renderUseStatus(active);
  renderSetList();
}

function renderUseStatus(set) {
  const lastUse = getLastUse(set);

  if (!lastUse) {
    els.activeUseStatus.hidden = true;
    els.lastUseTime.textContent = '—';
    els.lastValidUntil.textContent = '—';
    return;
  }

  const validUntil = getValidUntilText(lastUse.usedAt, set.validHours);

  els.activeUseStatus.hidden = false;
  els.lastUseTime.textContent = formatDateTimeJa(lastUse.usedAt);
  els.lastValidUntil.textContent = validUntil
    ? `${validUntil} まで`
    : '使用チケットの時間を設定すると表示されます';
}

function renderSetList() {
  els.setList.innerHTML = '';

  for (const set of state.sets) {
    const expiryInfo = getExpiryInfo(set);
    const li = document.createElement('li');
    li.className = `set-item${set.id === state.activeSetId ? ' active' : ''}`;

    const expiryLabel = expiryInfo.text
      ? expiryInfo.text.replace(/^期限: /, '')
      : '期限未設定';
    const expiryClass = expiryInfo.status === 'soon'
      ? ' soon'
      : expiryInfo.status === 'expired'
        ? ' expired'
        : '';

    li.innerHTML = `
      <div class="set-item-info">
        <div class="set-item-name set-item-expiry${expiryClass}">${escapeHtml(expiryLabel)}</div>
      </div>
      <div class="set-item-actions">
        <button type="button" class="set-delete-btn" data-id="${set.id}" aria-label="削除">🗑</button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.set-delete-btn')) return;
      state.activeSetId = set.id;
      save();
      updateUI();
    });

    li.querySelector('.set-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`「${getSetTitle(set)}」を削除しますか？`)) return;
      state.sets = state.sets.filter((s) => s.id !== set.id);
      if (state.activeSetId === set.id) {
        state.activeSetId = state.sets[0]?.id || null;
      }
      save();
      updateUI();
      showToast('削除しました');
    });

    els.setList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

async function copyToClipboard(text) {
  if (isNativeApp() && window.Capacitor.Plugins?.Clipboard) {
    try {
      await window.Capacitor.Plugins.Clipboard.write({ string: text });
      return true;
    } catch {
      /* fall through */
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

function buildPovoTargets(preferred) {
  const list = [];
  const push = (t) => {
    const v = (t || '').trim();
    if (v && !list.includes(v)) list.push(v);
  };

  push(preferred);
  push(state.settings.povoTarget);
  push(state.settings.povoTargetLastOk);
  POVO_TARGET_CANDIDATES.forEach(push);
  return list;
}

function getConfiguredWebPovoTarget(preferred) {
  const candidates = [
    preferred,
    state.settings.povoTarget,
    state.settings.povoTargetLastOk,
  ];

  return candidates
    .map((target) => (target || '').trim())
    .find((target) => /^(povo:\/\/|https:\/\/kddi-povo\.app\.link\/)/i.test(target)) || '';
}

function launchAndroidPovo() {
  // Chromeのユーザー操作中に、POVOの公式アプリリンクをAndroidへ渡す。
  // 公式のプロモコード直リンクは公開されていないため、アプリのホームを開く。
  const fallback = 'https://play.google.com/store/apps/details?id=' + POVO_PACKAGE;
  const intent = 'intent://kddi-povo.app.link/#Intent;scheme=https;package='
    + POVO_PACKAGE
    + ';action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE'
    + ';S.browser_fallback_url=' + encodeURIComponent(fallback)
    + ';end';

  const link = document.createElement('a');
  link.href = intent;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();

  showToast('POVOアプリを開きました。ホーム画面下部の「プロモコード」をタップしてください');
  setTimeout(() => {
    if (document.visibilityState !== 'hidden') {
      showToast('開かない場合は、このページをChromeで開いてください');
    }
  }, 1500);
}

async function openPovoApp(preferred) {
  if (isNativeApp() && window.Capacitor.Plugins?.PovoLauncher) {
    try {
      const result = await window.Capacitor.Plugins.PovoLauncher.open({
        targets: buildPovoTargets(preferred),
      });
      const target = result?.target;

      // 通常起動に落ちた場合は覚えない（次回また候補を試す）
      if (target && target !== 'launcher' && state.settings.povoTargetLastOk !== target) {
        state.settings.povoTargetLastOk = target;
        save();
      }
      if (target === 'launcher') {
        showToast('ホーム → プロモコード を開いて貼り付けてください');
      }
      return target;
    } catch {
      showToast('POVOアプリを開けませんでした。手動で開いてください');
      return null;
    }
  }

  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    const directTarget = getConfiguredWebPovoTarget(preferred);
    if (!directTarget) {
      launchAndroidPovo();
      return 'launcher';
    }

    let appOpened = false;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') appOpened = true;
    };

    document.addEventListener('visibilitychange', onVisibilityChange, { once: true });
    window.location.href = directTarget;

    setTimeout(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (appOpened || document.visibilityState === 'hidden') return;
      launchAndroidPovo();
    }, 1500);
  } else if (isIOS) {
    window.location.href = 'https://apps.apple.com/jp/app/id1554037102';
  } else {
    showToast('Androidスマホで開くとPOVOアプリを起動できます');
  }
}
async function useNextCode() {
  const set = getActiveSet();
  if (!set) return;

  const next = getNextUsableCode(set);
  if (!next) {
    showToast('残りのコードがありません');
    return;
  }

  if (state.settings.confirmUse) {
    const stats = getSetStats(set);
    const msg = `コードを使用しますか？\n\n${next.code}\n\n（${stats.used + 1} / ${stats.total} 回目）`;
    if (!confirm(msg)) return;
  }

  // Web版ではコピー処理を開始した直後にIntentを発行し、
  // ブラウザのユーザー操作扱いが切れにくいようにする。
  const copyPromise = copyToClipboard(next.code);
  if (state.settings.autoOpenApp && !isNativeApp()) {
    openPovoApp();
  }
  const copied = await copyPromise;
  if (!copied) {
    showToast('コピーに失敗しました。手動でコピーしてください');
    return;
  }

  const codeIndex = set.codes.indexOf(next);
  set.lastUse = { usedAt: new Date().toISOString(), codeIndex };
  next.usedCount = Math.min(next.maxUses, next.usedCount + 1);
  ensureEntryShape(next);
  state.lastCopiedCode = next.code;
  save();
  updateUI();

  showToast('コピーしました！ プロモコード画面で貼り付けてください');

  if (state.settings.autoOpenApp && isNativeApp()) {
    setTimeout(() => openPovoApp(), 400);
  }
}

function undoLastUse() {
  const set = getActiveSet();
  if (!set) return;

  const lastUse = getLastUse(set);
  if (!lastUse) {
    showToast('取り消す使用記録がありません');
    return;
  }

  const entry = set.codes[lastUse.codeIndex];
  if (!entry) {
    showToast('取り消しに失敗しました');
    return;
  }

  if (!confirm(
    `最後に使用したコードを取り消しますか？\n\n${entry.code}\n${formatDateTimeJa(lastUse.usedAt)}`
  )) return;

  entry.usedCount = Math.max(0, entry.usedCount - 1);
  ensureEntryShape(entry);
  set.lastUse = null;
  state.lastCopiedCode = null;
  els.lastCodeBox.hidden = true;

  save();
  updateUI();
  showToast('取り消しました');
}

function openAddModal() {
  els.expiresAt.value = '';
  els.codesInput.value = '';
  els.maxUsesInput.value = '1';
  els.maxUsesField.hidden = true;
  els.parsedPreview.hidden = true;
  els.parsedCodesList.innerHTML = '';
  els.parsedCodesList.hidden = true;
  els.saveSetBtn.disabled = true;
  els.addModal.showModal();
  setTimeout(() => els.codesInput.focus(), 100);
}

function getRegistrationPreview() {
  const text = els.codesInput.value;
  const contextText = getRegistrationContextText();
  const parsed = parseRegistration(text, contextText);

  if (parsed.codes.length === 0) {
    return { valid: false, parsed, totalUses: 0, summary: '' };
  }

  if (parsed.mode === 'multi') {
    return {
      valid: true,
      parsed,
      totalUses: parsed.totalUses,
      summary: `${parsed.codes.length} 個のコード（合計 ${parsed.totalUses} 回）を検出しました`,
      showMaxUses: false,
      maxUses: 1,
    };
  }

  const manualMaxUses = Math.max(1, Number(els.maxUsesInput.value) || 1);
  const maxUses = parsed.detectedMaxUses || manualMaxUses;

  if (parsed.mode === 'repeat') {
    return {
      valid: true,
      parsed,
      totalUses: maxUses,
      summary: `同一コードを ${maxUses} 回使える形式として検出しました`,
      showMaxUses: true,
      maxUses,
    };
  }

  return {
    valid: true,
    parsed,
    totalUses: maxUses,
    summary: maxUses > 1
      ? `1 個のコード × ${maxUses} 回`
      : '1 個のコードを検出しました（使用回数を確認してください）',
    showMaxUses: true,
    maxUses,
  };
}

function renderParsedCodes(codes) {
  els.parsedCodesList.innerHTML = '';
  for (const code of codes) {
    const li = document.createElement('li');
    li.textContent = code;
    els.parsedCodesList.appendChild(li);
  }
  els.parsedCodesList.hidden = codes.length === 0;
}

function onRegistrationInput() {
  autofillFromPastedText(els.codesInput.value);
  const preview = getRegistrationPreview();

  if (!preview.valid) {
    els.parsedPreview.hidden = true;
    els.parsedCodesList.innerHTML = '';
    els.parsedCodesList.hidden = true;
    els.maxUsesField.hidden = true;
    els.saveSetBtn.disabled = true;
    return;
  }

  els.parsedPreview.hidden = false;
  els.parsedSummary.textContent = preview.summary;
  renderParsedCodes(preview.parsed.codes);
  els.maxUsesField.hidden = !preview.showMaxUses;
  if (preview.showMaxUses) {
    if (preview.parsed.detectedMaxUses && preview.parsed.detectedMaxUses > 1) {
      els.maxUsesInput.value = String(preview.parsed.detectedMaxUses);
    } else if (preview.maxUses > 1) {
      els.maxUsesInput.value = String(preview.maxUses);
    }
  }
  els.saveSetBtn.disabled = false;
}
function saveNewSet(e) {
  e.preventDefault();

  const preview = getRegistrationPreview();
  if (!preview.valid) {
    showToast('コードが見つかりませんでした');
    return;
  }

  const { parsed } = preview;
  const contextText = getRegistrationContextText();
  const maxUses = parsed.mode === 'multi'
    ? 1
    : Math.max(
      1,
      Number(els.maxUsesInput.value) || parsed.detectedMaxUses || inferMaxUsesFromText(contextText) || 1
    );
  const totalUses = parsed.mode === 'multi' ? parsed.totalUses : maxUses;

  const expiry = parseExpiryValue(els.expiresAt.value.trim());

  const newSet = {
    id: crypto.randomUUID(),
    expiresAt: expiry?.display || els.expiresAt.value.trim(),
    validHours: detectValidHours(contextText) || 24,
    createdAt: new Date().toISOString(),
    codes: createCodeEntries(parsed.codes, maxUses),
  };

  state.sets.unshift(newSet);
  state.activeSetId = newSet.id;
  save();
  updateUI();
  els.addModal.close();
  showToast(`${totalUses} 回分を登録しました`);
}

function populateSettingsSetFields() {
  const set = getActiveSet();
  const hasSet = Boolean(set);

  els.settingsSetSection.hidden = !hasSet;
  if (!hasSet) return;

  const stats = getSetStats(set);

  const { hours, days } = splitValidHours(set.validHours);
  els.settingsValidHours.value = String(hours);
  els.settingsValidDays.value = String(days);
  els.settingsExpiresAt.value = set.expiresAt || '';
  els.settingsUsed.value = String(stats.used);
  els.settingsRemaining.value = String(stats.remaining);
  els.settingsTotal.value = String(stats.total);
}

function syncSettingsCountFields(changed) {
  const used = Number(els.settingsUsed.value);
  const remaining = Number(els.settingsRemaining.value);
  const total = Number(els.settingsTotal.value);

  if (!Number.isFinite(used) || !Number.isFinite(remaining) || !Number.isFinite(total)) {
    return;
  }

  if (changed === 'used') {
    els.settingsRemaining.value = String(Math.max(0, total - used));
  } else if (changed === 'remaining') {
    els.settingsUsed.value = String(Math.max(0, total - remaining));
  } else if (changed === 'total') {
    els.settingsRemaining.value = String(Math.max(0, total - used));
  }
}

function applySetCounts(set, used, remaining, total) {
  if (
    !Number.isInteger(used)
    || !Number.isInteger(remaining)
    || !Number.isInteger(total)
    || used < 0
    || remaining < 0
    || total < 1
    || used + remaining !== total
  ) {
    return false;
  }

  if (set.codes.length === 1) {
    const entry = set.codes[0];
    entry.maxUses = total;
    entry.usedCount = used;
    ensureEntryShape(entry);
    return true;
  }

  const templateCode = set.codes[0]?.code || '';

  if (total > set.codes.length) {
    while (set.codes.length < total) {
      set.codes.push({ code: templateCode, usedCount: 0, maxUses: 1 });
    }
  } else if (total < set.codes.length) {
    const usedSlots = set.codes.reduce((sum, entry) => sum + entry.usedCount, 0);
    if (total < usedSlots) return false;
    while (set.codes.length > total) {
      const last = set.codes[set.codes.length - 1];
      if (last.usedCount > 0) return false;
      set.codes.pop();
    }
  }

  let usedLeft = used;
  for (const entry of set.codes) {
    entry.maxUses = 1;
    if (usedLeft > 0) {
      entry.usedCount = 1;
      usedLeft -= 1;
    } else {
      entry.usedCount = 0;
      ensureEntryShape(entry);
    }
  }

  return true;
}

function saveActiveSetFromSettings() {
  const set = getActiveSet();
  if (!set) return false;

  const expiresAt = els.settingsExpiresAt.value.trim();
  const used = Number(els.settingsUsed.value);
  const remaining = Number(els.settingsRemaining.value);
  const total = Number(els.settingsTotal.value);

  set.validHours = combineValidHours(
    els.settingsValidHours.value,
    els.settingsValidDays.value
  );
  const expiry = parseExpiryValue(expiresAt);
  set.expiresAt = expiry?.display || expiresAt;
  migrateSetMaxUses(set);

  if (!applySetCounts(set, used, remaining, total)) {
    showToast('使用済み + 残り = 合計 になるように入力してください');
    populateSettingsSetFields();
    return false;
  }

  if (!getSetStats(set).remaining && !getLastUse(set)) {
    state.lastCopiedCode = null;
  }

  save();
  updateUI();
  populateSettingsSetFields();
  return true;
}

function renderPovoTargetStatus() {
  const ok = state.settings.povoTargetLastOk;
  els.povoTargetStatus.textContent = ok
    ? `前回開けた遷移先: ${ok}`
    : '前回開けた遷移先: — （通常起動でホーム画面が開きます）';
}

async function findPovoTargets() {
  if (!isNativeApp() || !window.Capacitor.Plugins?.PovoLauncher?.listTargets) {
    showToast('Androidアプリ版でのみ利用できます');
    return;
  }

  let result;
  try {
    result = await window.Capacitor.Plugins.PovoLauncher.listTargets();
  } catch {
    showToast('候補を取得できませんでした');
    return;
  }

  const activities = result?.activities || [];
  els.povoTargetList.innerHTML = '';

  if (!activities.length) {
    els.povoTargetList.hidden = true;
    showToast(result?.installed ? '公開されている画面が見つかりません' : 'POVOアプリが見つかりません');
    return;
  }

  for (const item of activities) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.name;
    btn.addEventListener('click', () => {
      els.povoTarget.value = item.target;
      saveSettings();
      openPovoApp(item.target);
    });
    li.appendChild(btn);
    els.povoTargetList.appendChild(li);
  }

  els.povoTargetList.hidden = false;
  showToast(`${activities.length} 件の候補が見つかりました`);
}

function openSettings() {
  els.autoOpenApp.checked = state.settings.autoOpenApp;
  els.confirmUse.checked = state.settings.confirmUse;
  els.povoTarget.value = state.settings.povoTarget;
  renderPovoTargetStatus();
  populateSettingsSetFields();
  els.settingsModal.showModal();
}

function saveSettings() {
  state.settings.autoOpenApp = els.autoOpenApp.checked;
  state.settings.confirmUse = els.confirmUse.checked;

  const target = els.povoTarget.value.trim();
  if (target !== state.settings.povoTarget) {
    state.settings.povoTarget = target;
    // 遷移先を変えたら学習済みの値はリセット
    state.settings.povoTargetLastOk = '';
  }

  save();
  renderPovoTargetStatus();
}

function closeModal(dialog) {
  if (dialog?.open) dialog.close();
}

function bindModalDismiss(dialog) {
  if (!dialog) return;

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeModal(dialog);
  });

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeModal(dialog);
  });
}

function bindEvents() {
  $('useCodeBtn').addEventListener('click', useNextCode);
  $('openPovoBtn').addEventListener('click', () => openPovoApp());
  $('undoBtn').addEventListener('click', undoLastUse);
  $('copyAgainBtn').addEventListener('click', async () => {
    if (!state.lastCopiedCode) return;
    await copyToClipboard(state.lastCopiedCode);
    showToast('再コピーしました');
  });

  $('addSetBtn').addEventListener('click', openAddModal);
  $('emptyAddBtn').addEventListener('click', openAddModal);
  $('closeAddModal').addEventListener('click', () => closeModal(els.addModal));
  $('cancelAdd').addEventListener('click', () => closeModal(els.addModal));
  els.codesInput.addEventListener('input', onRegistrationInput);
  els.expiresAt.addEventListener('input', onRegistrationInput);
  els.maxUsesInput.addEventListener('input', onRegistrationInput);
  els.addForm.addEventListener('submit', saveNewSet);

  $('settingsBtn').addEventListener('click', openSettings);
  $('closeSettingsModal').addEventListener('click', () => {
    saveActiveSetFromSettings();
    closeModal(els.settingsModal);
  });
  $('closeSettingsDone').addEventListener('click', () => {
    saveActiveSetFromSettings();
    closeModal(els.settingsModal);
  });
  els.settingsValidHours.addEventListener('change', saveActiveSetFromSettings);
  els.settingsValidDays.addEventListener('change', saveActiveSetFromSettings);
  els.settingsExpiresAt.addEventListener('change', saveActiveSetFromSettings);
  els.settingsUsed.addEventListener('input', () => syncSettingsCountFields('used'));
  els.settingsRemaining.addEventListener('input', () => syncSettingsCountFields('remaining'));
  els.settingsTotal.addEventListener('input', () => syncSettingsCountFields('total'));
  els.settingsUsed.addEventListener('change', saveActiveSetFromSettings);
  els.settingsRemaining.addEventListener('change', saveActiveSetFromSettings);
  els.settingsTotal.addEventListener('change', saveActiveSetFromSettings);
  bindModalDismiss(els.settingsModal);
  bindModalDismiss(els.addModal);
  els.autoOpenApp.addEventListener('change', saveSettings);
  els.confirmUse.addEventListener('change', saveSettings);
  els.povoTarget.addEventListener('change', saveSettings);
  $('testPovoTargetBtn').addEventListener('click', async () => {
    saveSettings();
    await openPovoApp();
    renderPovoTargetStatus();
  });
  $('findPovoTargetBtn').addEventListener('click', findPovoTargets);
}

async function initNativeUi() {
  if (!isNativeApp()) return;

  try {
    await window.Capacitor.Plugins?.StatusBar?.setOverlaysWebView?.({ overlay: false });
    await window.Capacitor.Plugins?.StatusBar?.setBackgroundColor?.({ color: '#ff6b00' });
  } catch {
    /* optional */
  }
}

load();
bindEvents();
updateUI();
initNativeUi();

if ('serviceWorker' in navigator && !isNativeApp()) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}