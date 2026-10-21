/* =========================================================
   코나비즈 — landing.js
   02 결제 시뮬레이터 · 03 상담예약 · 04 로그인 모달 동작
   ※ 결제 판단은 아직 브라우저에서 흉내냄. 로그인·예약은 FastAPI(/api/auth/login · /api/reservations)
   ========================================================= */
(function () {
  'use strict';

  var won = function (n) { return n.toLocaleString('ko-KR') + '원'; };
  /* 받침에 따라 은/는 */
  var eun = function (w) {
    var c = w.charCodeAt(w.length - 1) - 0xAC00;
    return w + (c >= 0 && c <= 11171 && c % 28 === 0 ? '는' : '은');
  };
  var store = {   /* 로컬스토리지는 실패해도 화면이 동작하게 */
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } }
  };

  /* =======================================================
     02 결제 시뮬레이터
     ======================================================= */
  var POCKETS = [
    { id: 'meal', name: '식대P' },
    { id: 'fitness', name: '체력단련P' },
    { id: 'welfare', name: '복지P' },
    { id: 'expense', name: '법인경비P' }
  ];
  var POCKET_NAME = { meal: '식대P', fitness: '체력단련P', welfare: '복지P', expense: '법인경비P' };

  /* 가맹점 업종 → 전용 포인트 (restricted = 제한 업종) */
  var MERCHANTS = [
    { id: 'restaurant', name: '일반음식점', type: 'meal' },
    { id: 'cafe', name: '커피전문점', type: 'meal' },
    { id: 'book', name: '도서·학원', type: 'meal' },
    { id: 'fitness', name: '체력단련·골프', type: 'fitness' },
    { id: 'hospital', name: '병원·약국', type: 'fitness' },
    { id: 'office', name: '사무용품', type: 'expense' },
    { id: 'travel', name: '출장', type: 'expense' },
    { id: 'bar', name: '유흥주점', type: 'restricted' }
  ];
  var BAR_ALERT = { title: '제한 업종', desc: '유흥주점은 어떤 포인트로도 결제할 수 없어요' };
  /* 상담예약 1단계 업종 칩 전체 — 거래처 접대(entertain)는 규칙 카드에만 있고 시뮬레이터 가맹점에는 없음 */
  var ALL_CATS = ['restaurant', 'cafe', 'book', 'fitness', 'hospital', 'office', 'travel', 'entertain'];

  /* 프리셋 1은 기획서 9.6 문구 그대로. 프리셋 2~4 문구·잔액은 기획서 14.1 "남은 정의 항목" — 임시안 */
  var PRESETS = [
    {
      mode: 'priority',
      rules: [
        ['1순위 차감  ·  식대P', '일반음식점, 커피전문점, 도서·학원'],
        ['2순위 차감  ·  체력단련P', '체력단련 · 골프, 병원 · 약국'],
        ['3순위 차감  ·  복지P', '제한 업종을 뺀 모든 가맹점'],
        ['법인경비P · 별도 예산', '사무용품, 출장(항공·숙박), 거래처 접대 — 순위와 상관없이 따로 차감']
      ],
      balance: { meal: 150000, fitness: 100000, welfare: 100000, expense: 500000 },
      custom: { time: [0, 24], limit: 100000, cats: ALL_CATS }
    },
    {
      mode: 'split',
      rules: [
        ['1순위 차감  ·  식대P', '일반음식점, 커피전문점, 도서·학원 — 잔액이 모자라면 다음 순위로 이어서 차감'],
        ['2순위 차감  ·  복지P', '앞 순위에서 모자란 금액을 이어서 차감'],
        ['부족금액 자동충전', '그래도 모자라면 모자란 만큼만 회사 예산에서 자동으로 충전해 결제'],
        ['법인경비P · 별도 예산', '사무용품, 출장(항공·숙박), 거래처 접대 — 순위와 상관없이 따로 차감']
      ],
      balance: { meal: 20000, fitness: 100000, welfare: 10000, expense: 500000 },
      custom: { time: [0, 24], limit: 100000, cats: ALL_CATS }
    },
    {
      mode: 'priority',
      blocked: ['fitness'],
      limit: 30000,
      rules: [
        ['회사 지정 차단 업종', '체력단련·골프 — 회사 정책에 따라 결제를 막아요'],
        ['1회 한도  ·  30,000원', '30,000원을 넘는 결제는 막아요'],
        ['1순위 차감  ·  식대P', '일반음식점, 커피전문점, 도서·학원'],
        ['2순위 차감  ·  복지P', '차단 업종을 뺀 모든 가맹점']
      ],
      balance: { meal: 150000, fitness: 100000, welfare: 100000, expense: 500000 },
      custom: { time: [0, 24], limit: 30000, cats: ['restaurant', 'cafe', 'book', 'hospital', 'office', 'travel', 'entertain'] }
    },
    {
      mode: 'priority',
      allowed: ['restaurant', 'fitness', 'office'],
      limit: 50000,
      rules: [
        ['허용 업종', '일반음식점, 체력단련·골프, 사무용품 — 고른 업종에서만 결제돼요'],
        ['1회 한도  ·  50,000원', '50,000원까지 결제할 수 있어요'],
        ['결제 가능 시간  ·  09:00 - 20:00', '체험에서는 시간 제한을 적용하지 않아요'],
        ['조건 바꿔보기', '상담 예약 1단계에서 우리 회사 조건으로 직접 바꿔볼 수 있어요']
      ],
      balance: { meal: 150000, fitness: 100000, welfare: 100000, expense: 500000 },
      custom: { time: [9, 20], limit: 50000, cats: ['restaurant', 'fitness', 'office'] }
    }
  ];

  /* 결제 판단: { ok, amount, desc, after(잔액), changed[] } */
  function judge(preset, merchant, amount) {
    var bal = Object.assign({}, preset.balance);
    var block = function (desc) { return { ok: false, amount: amount, desc: desc, after: bal, changed: [] }; };

    if (merchant.type === 'restricted') return block(eun(merchant.name) + ' 제한 업종이라 결제할 수 없어요');
    if (preset.blocked && preset.blocked.indexOf(merchant.id) > -1) return block(eun(merchant.name) + ' 회사가 막아둔 업종이라 결제할 수 없어요');
    if (preset.allowed && preset.allowed.indexOf(merchant.id) === -1) return block(eun(merchant.name) + ' 허용 업종이 아니라 결제할 수 없어요');
    if (preset.limit && amount > preset.limit) return block('1회 한도 ' + won(preset.limit) + '을 넘어 결제할 수 없어요');

    var order = merchant.type === 'expense' ? ['expense']
      : preset.mode === 'split' ? [merchant.type, 'welfare'].filter(function (p, i, a) { return a.indexOf(p) === i; })
      : [merchant.type, 'welfare'];

    if (preset.mode === 'split' && merchant.type !== 'expense') {
      var left = amount, parts = [], changed = [];
      order.forEach(function (p) {
        var use = Math.min(bal[p], left);
        if (use > 0) { bal[p] -= use; left -= use; parts.push(POCKET_NAME[p] + ' ' + won(use)); changed.push(p); }
      });
      var desc = parts.join(' + ') + (parts.length ? '이 차감됐어요' : '');
      if (left > 0) desc += (parts.length ? '. ' : '') + '모자란 ' + won(left) + '은 자동충전됐어요';
      return { ok: true, amount: amount, desc: desc, after: bal, changed: changed };
    }

    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      if (bal[p] >= amount) {
        bal[p] -= amount;
        return { ok: true, amount: amount, desc: POCKET_NAME[p] + '에서 ' + won(amount) + '이 차감됐어요', after: bal, changed: [p] };
      }
    }
    return block('포인트 잔액이 모자라 결제할 수 없어요');
  }

  var sim = document.getElementById('modal-simulator');
  var simState = { preset: 0, merchant: 'cafe', amount: 30000, busy: false, result: null };
  var lastExperience = store.get('kona.simLast');   /* 상담예약 선택 조건 자동 채움용 */

  if (sim) {
    var presetTabs = sim.querySelector('[data-sim-presets]');
    var simPanel = sim.querySelector('#sim-panel');
    var rulesEl = sim.querySelector('[data-sim-rules]');
    var payForm = sim.querySelector('[data-pay-form]');
    var merchantSel = sim.querySelector('[data-sim-merchant]');
    var amountGroup = sim.querySelector('[data-sim-amounts]');
    var amountValue = sim.querySelector('[data-sim-amount-value]');
    var swipeBtn = sim.querySelector('[data-sim-swipe]');
    var resultEl = sim.querySelector('[data-sim-result]');
    var walletEl = sim.querySelector('[data-sim-wallet]');
    var actionsEl = sim.querySelector('[data-sim-actions]');

    merchantSel.innerHTML = MERCHANTS.map(function (m) {
      return '<option value="' + m.id + '">' + m.name + '</option>';
    }).join('');

    var renderRules = function () {
      var p = PRESETS[simState.preset];
      rulesEl.innerHTML = p.rules.map(function (r) {
        return '<li class="rule-card"><p class="rule-card__title">' + r[0] + '</p><p class="rule-card__desc">' + r[1] + '</p></li>';
      }).join('') +
        '<li class="alert-box"><img class="alert-box__icon" src="assets/icon-alert-danger.svg" alt="" width="20" height="20">' +
        '<div class="alert-box__text"><p class="alert-box__title">' + BAR_ALERT.title + '</p><p>' + BAR_ALERT.desc + '</p></div></li>';
    };

    var renderWallet = function (bal, changed) {
      walletEl.innerHTML = POCKETS.map(function (p) {
        var on = changed && changed.indexOf(p.id) > -1;
        return '<li class="info-row wallet-row' + (on ? ' is-changed' : '') + '">' +
          '<span class="info-row__label">' + p.name + '</span><span class="info-row__value">' + won(bal[p.id]) + '</span></li>';
      }).join('');
    };

    var renderResult = function (r) {
      resultEl.className = 'result-box' + (r ? (r.ok ? ' is-approved' : ' is-blocked') : '');
      if (!r) {
        resultEl.innerHTML = '<p class="result-box__idle">카드를 긁으면 여기에 결과가 나와요</p>';
        return;
      }
      var icon = r.ok ? 'assets/icon-check-success.svg' : 'assets/icon-stop-danger.svg';
      resultEl.innerHTML =
        '<div class="result-box__head"><span class="result-box__status"><img src="' + icon + '" alt="" width="20" height="20">' +
        (r.ok ? '승인' : '차단') + '</span><span class="result-box__amount">' + won(r.amount) + '</span></div>' +
        '<p>' + r.desc + '</p>';
    };

    var setLocked = function (locked) {
      payForm.classList.toggle('is-locked', locked);
      merchantSel.disabled = locked;
      /* 금액 칸은 disabled 대신 aria-disabled — 선택 상태(Ink)를 유지한 채 묶음째 50%로 보이게 */
      amountGroup.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-disabled', String(locked)); });
    };

    var simReset = function () {
      var p = PRESETS[simState.preset];
      simState.busy = false;
      simState.result = null;
      simState.merchant = 'cafe';
      simState.amount = 30000;
      merchantSel.value = 'cafe';
      Kona.selectItem(amountGroup, amountGroup.querySelector('[data-amount="30000"]'));
      amountValue.textContent = won(30000);
      setLocked(false);
      swipeBtn.disabled = false;
      swipeBtn.classList.remove('is-loading');
      swipeBtn.textContent = '카드 긁기';
      actionsEl.hidden = true;
      renderRules();
      renderWallet(p.balance);
      renderResult(null);
    };

    presetTabs.addEventListener('click', function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (!tab || simState.busy) return;
      Kona.selectItem(presetTabs, tab);
      simPanel.setAttribute('aria-labelledby', tab.id);
      simState.preset = Number(tab.getAttribute('data-preset'));
      simReset();   /* 탭을 바꾸면 결과 초기화 + 해당 프리셋 규칙·잔액으로 교체 */
    });

    merchantSel.addEventListener('change', function () { simState.merchant = merchantSel.value; });

    amountGroup.addEventListener('click', function (e) {
      var b = e.target.closest('[data-amount]');
      if (!b || payForm.classList.contains('is-locked')) return;
      Kona.selectItem(amountGroup, b);
      simState.amount = Number(b.getAttribute('data-amount'));
      amountValue.textContent = won(simState.amount);
    });

    swipeBtn.addEventListener('click', function () {
      if (simState.busy || simState.result) return;
      simState.busy = true;
      setLocked(true);
      swipeBtn.classList.add('is-loading');
      setTimeout(function () {
        var p = PRESETS[simState.preset];
        var merchant = MERCHANTS.filter(function (m) { return m.id === simState.merchant; })[0];
        var r = judge(p, merchant, simState.amount);
        simState.busy = false;
        simState.result = r;
        swipeBtn.classList.remove('is-loading');
        swipeBtn.textContent = r.ok ? '승인됨' : '차단됨';
        swipeBtn.disabled = true;
        renderResult(r);
        renderWallet(r.after, r.changed);
        actionsEl.hidden = false;

        lastExperience = { preset: simState.preset };
        store.set('kona.simLast', lastExperience);

        /* 결제 버튼이 잠기므로 다음 행동(상담 예약하기)으로 포커스 이동. 모바일은 결과 박스로 스크롤 */
        actionsEl.querySelector('.btn--primary').focus({ preventScroll: true });
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 600);
    });

    sim.querySelector('[data-sim-reset]').addEventListener('click', function () {
      simReset();
      swipeBtn.focus();
    });

    /* 닫으면 체험 상태 초기화 (상담예약으로 넘어갈 때도 동일) */
    sim.addEventListener('modal:close', function () {
      simState.preset = 0;
      Kona.selectItem(presetTabs, presetTabs.querySelector('[data-preset="0"]'));
      simPanel.setAttribute('aria-labelledby', 'sim-tab-0');
      simReset();
    });

    simReset();
  }

  /* =======================================================
     03 상담예약폼
     ======================================================= */
  var bk = document.getElementById('modal-booking');
  if (bk) {
    var bkForm = bk.querySelector('#booking-form');
    var bkTop = bk.querySelector('[data-booking-top]');
    var panel = bk.querySelector('.modal__panel');
    var views = bk.querySelectorAll('[data-view]');
    var bkState = { view: '1', method: null, slot: null, week: 0, minWeek: 0, activeDay: null,
      monday: 0, closed: [], slots: 'idle', req: 0, busy: false };   /* slots: idle | loading | ready | error */

    var showView = function (v) {
      bkState.view = v;
      views.forEach(function (el) { el.hidden = el.getAttribute('data-view') !== v; });
      bkTop.hidden = v === 'done';
      /* 단계 표시 */
      var s1 = bk.querySelector('[data-step-item="1"]');
      var s2 = bk.querySelector('[data-step-item="2"]');
      s1.classList.toggle('is-done', v === '2');
      s1.toggleAttribute('aria-current', v === '1');
      if (v === '1') s1.setAttribute('aria-current', 'step');
      s2.toggleAttribute('aria-current', v === '2');
      if (v === '2') s2.setAttribute('aria-current', 'step');
      bk.querySelector('[data-step-line]').classList.toggle('is-done', v === '2');
      /* 완료는 480 · 모바일 하단 시트 */
      bk.classList.toggle('modal--md', v !== 'done');
      bk.classList.toggle('modal--sm', v === 'done');
      bk.classList.toggle('modal--sheet-full', v !== 'done');
      panel.setAttribute('aria-labelledby', v === 'done' ? 'booking-done-title' : 'booking-title');
      bk.querySelectorAll('.modal__body').forEach(function (b) { b.scrollTop = 0; });
    };

    /* 입력값이 있으면 오버레이 클릭으로 닫히지 않게 표시 */
    var markDirty = function () {
      var dirty = bkState.view !== 'done' && (
        Array.prototype.some.call(bkForm.querySelectorAll('.field__input'), function (i) { return i.value.trim() !== ''; }) ||
        !!bkState.method || !!bkState.slot);
      bk.toggleAttribute('data-dirty', dirty);
    };
    bkForm.addEventListener('input', markDirty);

    /* ---------- 1/2 검사 (서버 backend/app/routers/reservations.py도 같은 규칙) ---------- */
    var isCount = function (v) {   /* 쉼표 허용, 1 ~ 1,000,000 */
      var n = v.replace(/,/g, '');
      return /^\d{1,7}$/.test(n) && Number(n) > 0 && Number(n) <= 1000000;
    };
    var RULES = {
      company: function (v) { return v ? '' : '회사명을 입력해주세요.'; },
      employees: function (v) { return isCount(v) ? '' : '임직원 수를 숫자로 입력해주세요.'; },
      cards: function (v) { return isCount(v) ? '' : '필요한 카드 수를 숫자로 입력해주세요.'; },
      name: function (v) { return v ? '' : '담당자 이름을 입력해주세요.'; },
      phone: function (v) { return /^01[016789]-?\d{3,4}-?\d{4}$/.test(v.replace(/\s/g, '')) ? '' : '연락 가능한 휴대폰 번호를 입력해주세요.'; },
      email: function (v) { return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : '이메일 형식을 확인해주세요.'; }
    };

    var setError = function (field, msg) {
      field.classList.toggle('is-error', !!msg);
      var err = field.querySelector('.field__error');
      var input = field.querySelector('.field__input');
      if (err) err.textContent = msg || '';
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };

    bk.querySelectorAll('[data-view="1"] [data-field]').forEach(function (field) {
      var input = field.querySelector('.field__input');
      input.addEventListener('input', function () { if (field.classList.contains('is-error')) setError(field, ''); });
    });

    bkForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (bkState.view !== '1') return;
      var firstBad = null;
      Object.keys(RULES).forEach(function (key) {
        var field = bk.querySelector('[data-view="1"] [data-field="' + key + '"]');
        var msg = RULES[key](field.querySelector('.field__input').value.trim());
        setError(field, msg);
        if (msg && !firstBad) firstBad = field;
      });
      if (firstBad) {   /* 첫 오류 칸으로 스크롤 + 포커스 (고정 머리 아래로 가려지지 않게) */
        firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
        firstBad.querySelector('.field__input').focus({ preventScroll: true });
        return;
      }
      showView('2');
      showBookAlert('');
      loadSlots(true);
      bk.querySelector('[data-method-group] [role="radio"]:not([tabindex="-1"])').focus();
    });

    /* ---------- 선택 조건 (접기 영역 · 슬라이더 · 업종 칩) ---------- */
    var customToggle = bk.querySelector('[data-custom-toggle]');
    var customBody = bk.querySelector('#bk-custom');
    customToggle.addEventListener('click', function () {
      var open = customToggle.getAttribute('aria-expanded') !== 'true';
      customToggle.setAttribute('aria-expanded', String(open));
      customBody.hidden = !open;
    });

    var hh = function (h) { return (h < 10 ? '0' : '') + h + ':00'; };
    var timeRange = bk.querySelector('[data-range="time"]');
    var tFrom = timeRange.querySelector('[data-range-from]');
    var tTo = timeRange.querySelector('[data-range-to]');
    var limitRange = bk.querySelector('[data-range="limit"]');
    var limitInput = limitRange.querySelector('[data-range-single]');

    var paintTime = function (moved) {
      var a = Number(tFrom.value), b = Number(tTo.value);
      if (a > b) {   /* 두 손잡이는 서로를 넘지 못함 */
        if (moved === tFrom) tFrom.value = a = b; else tTo.value = b = a;
      }
      var track = timeRange.querySelector('.range__track');
      track.style.setProperty('--from', (a / 24 * 100) + '%');
      track.style.setProperty('--to', (b / 24 * 100) + '%');
      timeRange.querySelector('[data-range-value]').textContent = hh(a) + ' - ' + hh(b);
      tFrom.setAttribute('aria-valuetext', hh(a));
      tTo.setAttribute('aria-valuetext', hh(b));
      /* 위에 있는 손잡이가 잡히도록: 시작 손잡이가 끝에 붙으면 시작을 위로 */
      tFrom.style.zIndex = a >= 23 ? 2 : 1;
    };
    var paintLimit = function () {
      var v = Number(limitInput.value);
      limitRange.querySelector('.range__track').style.setProperty('--to', (v / 100000 * 100) + '%');
      limitRange.querySelector('[data-range-value]').textContent = won(v);
      limitInput.setAttribute('aria-valuetext', won(v));
    };
    tFrom.addEventListener('input', function () { paintTime(tFrom); });
    tTo.addEventListener('input', function () { paintTime(tTo); });
    limitInput.addEventListener('input', paintLimit);

    bk.querySelectorAll('.chip-toggle').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (chip.getAttribute('aria-disabled') === 'true') return;
        chip.setAttribute('aria-checked', String(chip.getAttribute('aria-checked') !== 'true'));
      });
    });

    var applyCustom = function (c) {
      tFrom.value = c.time[0];
      tTo.value = c.time[1];
      limitInput.value = c.limit;
      bk.querySelectorAll('.chip-toggle[data-cat]').forEach(function (chip) {
        chip.setAttribute('aria-checked', String(c.cats.indexOf(chip.getAttribute('data-cat')) > -1));
      });
      paintTime();
      paintLimit();
    };

    /* ---------- 2/2 상담 방법 · 상담 일시 ---------- */
    /* 예약 가능 규칙 — backend/app/reservation_rules.py와 같게 맞춤 (한쪽을 고치면 같이 고침)
       오늘(KST)이 속한 주의 월요일부터 2주 · 월~금 · HOURS · 지난 시간은 예약 불가 */
    var HOURS = [10, 11, 14, 15, 16, 17];   /* 점심 12~13시 + 이동 버퍼 → 14시부터 재개 */
    var DAY = ['일', '월', '화', '수', '목', '금', '토'];
    var MAX_WEEK = 1;   /* 이번 주 + 다음 주 */
    var KST_MS = 9 * 3600000;
    var SANDBOX = new URLSearchParams(window.location.search).get('sandbox') === '1';   /* Sandbox에서는 예약 API를 부르지 않음 */
    var MSG_BOOK_FAIL = '일시적인 오류로 예약하지 못했어요. 잠시 후 다시 시도해주세요.';
    var methodGroup = bk.querySelector('[data-method-group]');
    var addressField = bk.querySelector('[data-field="address"]');
    var addressInput = addressField.querySelector('input');
    var weekRange = bk.querySelector('[data-week-range]');
    var weekNotice = bk.querySelector('[data-week-notice]');
    var prevWeek = bk.querySelector('[data-week="-1"]');
    var nextWeek = bk.querySelector('[data-week="1"]');
    var slotDays = bk.querySelector('[data-slot-days]');
    var slotGrid = bk.querySelector('[data-slot-grid]');
    var slotError = bk.querySelector('[data-slot-error]');
    var slotRetry = bk.querySelector('[data-slot-retry]');
    var bookAlert = bk.querySelector('[data-booking-alert]');
    var bookAlertMsg = bk.querySelector('[data-booking-alert-msg]');
    var summary = bk.querySelector('[data-booking-summary]');
    var prevBtn = bk.querySelector('[data-booking-prev]');
    var confirmBtn = bk.querySelector('[data-booking-confirm]');
    var CONFIRM_LABEL = confirmBtn.textContent;

    /* 날짜는 KST 날짜를 UTC 자정 Date로 다룸 → getUTC*로 읽음 (브라우저 시간대와 상관없이 같은 칸) */
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var ymd = function (d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
    var mdLabel = function (d) { return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일'; };
    var dow = function (d) { return DAY[d.getUTCDay()]; };

    var firstMonday = function () {
      var k = new Date(Date.now() + KST_MS);
      var mon = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
      mon.setUTCDate(mon.getUTCDate() - (mon.getUTCDay() + 6) % 7);
      return mon;
    };
    var weekDays = function (offset) {
      var mon = new Date(bkState.monday);
      mon.setUTCDate(mon.getUTCDate() + offset * 7);
      return [0, 1, 2, 3, 4].map(function (i) { var d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d; });
    };
    var slotTime = function (d, h) { return d.getTime() + h * 3600000 - KST_MS; };   /* KST 날짜 + 시 → 시각(ms) */
    /* 마감 = DB의 확정 예약 칸 + 이미 지난 칸 (같은 Disabled 모양) */
    var isClosed = function (d, h) { return bkState.closed.indexOf(ymd(d) + ' ' + h) > -1 || slotTime(d, h) <= Date.now(); };
    var weekHasOpen = function (offset) {
      return weekDays(offset).some(function (d) { return HOURS.some(function (h) { return !isClosed(d, h); }); });
    };

    var renderWeek = function () {
      var days = weekDays(bkState.week);
      var ready = bkState.slots === 'ready';
      weekRange.textContent = mdLabel(days[0]) + ' - ' + mdLabel(days[4]);
      prevWeek.disabled = bkState.week <= bkState.minWeek;
      nextWeek.disabled = bkState.week >= MAX_WEEK;
      var failed = bkState.slots === 'error';
      slotError.hidden = slotRetry.hidden = !failed;
      slotDays.hidden = slotGrid.hidden = failed;   /* 실패하면 시간 칸 자리에 안내 + [다시 시도] */
      slotGrid.setAttribute('aria-busy', String(bkState.slots === 'loading'));
      if (failed) return;

      var active = bkState.activeDay && days.some(function (d) { return ymd(d) === bkState.activeDay; })
        ? bkState.activeDay
        : ymd((days.filter(function (d) { return HOURS.some(function (h) { return !isClosed(d, h); }); })[0]) || days[0]);
      bkState.activeDay = active;

      slotDays.innerHTML = days.map(function (d, i) {
        var key = ymd(d), on = key === active;
        var picked = bkState.slot && bkState.slot.day === key;
        return '<button class="slot-day' + (picked ? ' has-pick' : '') + '" type="button" role="tab" id="bk-day-' + i + '" aria-controls="bk-col-' + i + '" aria-selected="' + on + '"' + (on ? '' : ' tabindex="-1"') + ' data-day="' + key + '">' +
          dow(d) + '<strong>' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '</strong></button>';
      }).join('');

      slotGrid.innerHTML = days.map(function (d, i) {
        var key = ymd(d);
        var head = dow(d) + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
        var slots = HOURS.map(function (h) {
          if (!ready) return '<span class="segment__option slot skeleton" aria-hidden="true"></span>';   /* 불러오는 중 */
          var closed = isClosed(d, h);
          var picked = bkState.slot && bkState.slot.day === key && bkState.slot.hour === h;
          var label = mdLabel(d) + '(' + dow(d) + ') ' + hh(h) + (closed ? ' 마감' : '');
          return '<button class="segment__option slot" type="button" aria-pressed="' + !!picked + '" aria-label="' + label + '"' +
            (closed ? ' disabled' : '') + ' data-day="' + key + '" data-hour="' + h + '">' + hh(h) + '</button>';
        }).join('');
        return '<div class="slot-col' + (key === active ? ' is-active' : '') + '" id="bk-col-' + i + '" role="group" aria-label="' + head + '">' +
          '<p class="slot-col__head" aria-hidden="true">' + head + '</p><div class="slot-col__list">' + slots + '</div></div>';
      }).join('');
    };

    /* 이번 주 남은 칸이 없으면(모두 마감 · 지남) 가장 빠른 예약 가능 주로 이동 (announce: 안내 문구) */
    var pickFirstWeek = function (announce) {
      bkState.minWeek = 0;
      while (bkState.minWeek < MAX_WEEK && !weekHasOpen(bkState.minWeek)) bkState.minWeek++;
      bkState.week = Math.max(bkState.week, bkState.minWeek);
      if (announce && bkState.minWeek > 0) {
        weekNotice.textContent = '이번 주는 예약 가능한 시간이 없어 가장 빠른 주를 보여드려요';
        weekNotice.hidden = false;
      }
    };

    /* 마감 시간 불러오기 — Step2에 들어올 때마다 · [다시 시도] · 409 뒤 */
    var loadSlots = function (announce) {
      var req = ++bkState.req;   /* 늦게 온 이전 응답은 버림 */
      bkState.monday = firstMonday().getTime();
      bkState.slots = 'loading';
      renderWeek();
      updateSummary();
      var done = function (closed) {
        if (req !== bkState.req) return;
        bkState.closed = closed;
        bkState.slots = 'ready';
        /* 고른 칸이 그사이 마감·지남·범위 밖이 되면 선택 해제 */
        if (bkState.slot) {
          var d = new Date(bkState.slot.date);
          var inRange = weekDays(0).concat(weekDays(MAX_WEEK)).some(function (x) { return ymd(x) === bkState.slot.day; });
          if (!inRange || isClosed(d, bkState.slot.hour)) bkState.slot = null;
        }
        pickFirstWeek(announce);
        renderWeek();
        updateSummary();
      };
      if (SANDBOX) { done([]); return; }
      var range = weekDays(0).concat(weekDays(MAX_WEEK));
      fetch('/api/reservations/slots?from=' + ymd(range[0]) + '&to=' + ymd(range[range.length - 1]), { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then(function (data) {
          /* "2026-10-21T11:00:00+09:00" → "2026-10-21 11" */
          done((data.closed || []).map(function (s) { return s.slice(0, 10) + ' ' + Number(s.slice(11, 13)); }));
        })
        .catch(function () {
          if (req !== bkState.req) return;
          bkState.slots = 'error';
          renderWeek();
          updateSummary();
        });
    };
    slotRetry.addEventListener('click', function () { loadSlots(true); });

    var updateSummary = function () {
      var methodText = bkState.method === 'phone' ? '전화 상담' : bkState.method === 'inperson' ? '대면 방문' : '';
      var ready = bkState.method && bkState.slot && (bkState.method !== 'inperson' || addressInput.value.trim());
      if (bkState.method && bkState.slot) {
        var d = new Date(bkState.slot.date);
        summary.textContent = mdLabel(d) + '(' + dow(d) + ') ' + hh(bkState.slot.hour) + ' · ' + methodText;
        summary.classList.remove('is-empty');
      } else {
        summary.textContent = '상담 방법과 시간을 골라주세요';
        summary.classList.add('is-empty');
      }
      /* 시간 목록을 불러오는 중 · 실패 · 예약 요청 중에도 비활성 */
      confirmBtn.disabled = !ready || bkState.slots !== 'ready' || bkState.busy;
      markDirty();
    };

    var showBookAlert = function (msg) {
      bookAlertMsg.textContent = msg || '';
      bookAlert.hidden = !msg;
      if (msg) bookAlert.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    methodGroup.addEventListener('click', function (e) {
      var b = e.target.closest('[data-method]');
      if (!b || bkState.busy) return;
      Kona.selectItem(methodGroup, b);
      bkState.method = b.getAttribute('data-method');
      addressField.hidden = bkState.method !== 'inperson';   /* 대면이면 주소 칸이 바로 나타남, 포커스는 이동하지 않음 */
      updateSummary();
    });
    addressInput.addEventListener('input', function () {
      if (addressField.classList.contains('is-error')) setError(addressField, '');
      updateSummary();
    });

    bk.querySelectorAll('[data-week]').forEach(function (b) {
      b.addEventListener('click', function () {
        bkState.week = Math.max(bkState.minWeek, Math.min(MAX_WEEK, bkState.week + Number(b.getAttribute('data-week'))));
        weekNotice.hidden = true;
        renderWeek();
      });
    });

    slotDays.addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]');
      if (!b) return;
      bkState.activeDay = b.getAttribute('data-day');
      Kona.selectItem(slotDays, b);
      slotGrid.querySelectorAll('.slot-col').forEach(function (c) {
        c.classList.toggle('is-active', c.id === b.getAttribute('aria-controls'));
      });
    });

    slotGrid.addEventListener('click', function (e) {
      var b = e.target.closest('button.slot');
      if (!b || b.disabled || bkState.busy) return;
      var day = b.getAttribute('data-day'), hour = Number(b.getAttribute('data-hour'));
      var date = weekDays(bkState.week).filter(function (d) { return ymd(d) === day; })[0];
      bkState.slot = { day: day, hour: hour, date: date.getTime() };   /* 하나만 선택, 주를 바꿔도 유지 */
      slotGrid.querySelectorAll('.slot').forEach(function (s) { s.setAttribute('aria-pressed', String(s === b)); });
      slotDays.querySelectorAll('.slot-day').forEach(function (s) { s.classList.toggle('has-pick', s.getAttribute('data-day') === day); });
      showBookAlert('');   /* 다른 시간을 고르면 이전 실패 안내는 지움 */
      updateSummary();
    });

    prevBtn.addEventListener('click', function () {
      showView('1');   /* 입력값 유지 */
      bk.querySelector('#bk-company').focus();
    });

    /* ---------- 예약 확정 → POST /api/reservations → 완료 ---------- */
    var maskPhone = function (v) {
      var n = v.replace(/\D/g, '');
      return n.slice(0, 3) + '-****-' + n.slice(-4);
    };
    var esc = function (s) {
      return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };
    var get = function (id) { return bk.querySelector('#' + id).value.trim(); };
    var currentPreset = function () {
      return {
        timeRange: [Number(tFrom.value), Number(tTo.value)], limitAmount: Number(limitInput.value),
        categories: Array.prototype.map.call(bk.querySelectorAll('.chip-toggle[aria-checked="true"]'), function (c) { return c.getAttribute('data-cat'); })
      };
    };

    var requestBody = function () {
      var p = currentPreset();
      var d = new Date(bkState.slot.date);
      return {
        company_name: get('bk-company'), employee_count: get('bk-employees'), card_count: get('bk-cards'),
        contact_name: get('bk-name'), contact_title: get('bk-position'), phone: get('bk-phone'), email: get('bk-email'),
        consultation_type: bkState.method, address: bkState.method === 'inperson' ? addressInput.value.trim() : '',
        preferred_at: ymd(d) + 'T' + pad(bkState.slot.hour) + ':00:00+09:00',
        custom_preset: { time_range: p.timeRange, limit_amount: p.limitAmount, categories: p.categories },
        source: bkState.source
      };
    };

    var setBooking = function (busy) {   /* 04 로그인 버튼과 같은 방식: 비활성 + 문구 (setBusy는 로그인에서 씀) */
      bkState.busy = busy;
      confirmBtn.textContent = busy ? '예약 중…' : CONFIRM_LABEL;
      prevBtn.disabled = busy;
      updateSummary();
    };

    /* 422 — Step1 항목이면 Step1로 돌아가 해당 칸, 주소는 그 칸, 시간은 안내 + 목록 다시 불러오기 */
    var STEP1_FIELD = { company_name: 'company', employee_count: 'employees', card_count: 'cards', contact_name: 'name', contact_title: 'position', phone: 'phone', email: 'email' };
    var showServerErrors = function (errors) {
      var step1 = Object.keys(STEP1_FIELD).filter(function (k) { return errors[k]; });
      if (step1.length) {
        showView('1');
        step1.forEach(function (k) { setError(bk.querySelector('[data-view="1"] [data-field="' + STEP1_FIELD[k] + '"]'), errors[k]); });
        var first = bk.querySelector('[data-view="1"] .field.is-error');
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        first.querySelector('.field__input').focus({ preventScroll: true });
        return;
      }
      if (errors.address) {
        setError(addressField, errors.address);
        addressInput.focus();
        return;
      }
      if (errors.preferred_at) {
        bkState.slot = null;
        showBookAlert(errors.preferred_at);
        loadSlots(false);
        return;
      }
      showBookAlert(errors.consultation_type || MSG_BOOK_FAIL);
    };

    var finishBooking = function () {
      var d = new Date(bkState.slot.date);
      var when = mdLabel(d) + '(' + dow(d) + ') ' + hh(bkState.slot.hour);
      var rows = [
        ['상담 일시', when],
        ['상담 방식', bkState.method === 'phone' ? '전화 상담' : '대면 방문'],
        bkState.method === 'phone' ? ['연락처', maskPhone(get('bk-phone'))] : ['방문 주소', addressInput.value.trim()],
        ['담당자', '김민준 · 010-9876-4321']   /* 예시 담당자 */
      ];
      bk.querySelector('[data-done-info]').innerHTML = rows.map(function (r) {
        return '<li class="info-row"><span class="info-row__label">' + r[0] + '</span><span class="info-row__value">' + esc(r[1]) + '</span></li>';
      }).join('');

      store.set('kona.reservation', {
        companyName: get('bk-company'), employeeCount: get('bk-employees'), cardCount: get('bk-cards'),
        contactName: get('bk-name'), contactTitle: get('bk-position'), phone: get('bk-phone'), email: get('bk-email'),
        consultationType: bkState.method, address: addressInput.value.trim(),
        preferredDate: bkState.slot.day, preferredTime: hh(bkState.slot.hour),
        preferredLabel: (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + dow(d) + ') ' + hh(bkState.slot.hour),   /* Sandbox 바 표시용 "10/21(수) 14:00" */
        customPreset: currentPreset(),
        source: bkState.source, createdAt: new Date().toISOString()
      });

      showView('done');
      bk.removeAttribute('data-dirty');
      bk.querySelector('#booking-done-title').focus();
    };

    confirmBtn.addEventListener('click', function () {
      if (confirmBtn.disabled || bkState.busy) return;
      showBookAlert('');
      if (SANDBOX) { finishBooking(); return; }
      setBooking(true);
      fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(requestBody())
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      }).then(function (r) {
        setBooking(false);
        if (r.res.status === 201) { finishBooking(); return; }
        if (r.res.status === 409) {   /* 방금 다른 예약이 확정된 시간 — Step2에 머묾, 시간만 해제하고 목록 새로고침 */
          bkState.slot = null;
          showBookAlert(typeof r.data.detail === 'string' ? r.data.detail : MSG_BOOK_FAIL);
          loadSlots(false);
          return;
        }
        if (r.res.status === 422 && r.data.errors) { showServerErrors(r.data.errors); return; }
        showBookAlert(MSG_BOOK_FAIL);
      }).catch(function () {
        setBooking(false);
        showBookAlert(MSG_BOOK_FAIL);
      });
    });

    bk.querySelector('[data-done-later]').addEventListener('click', function () { Kona.closeModal('later'); });

    /* ---------- 열기 · 닫기 ---------- */
    var resetBooking = function () {
      bkForm.reset();
      bk.querySelectorAll('[data-field]').forEach(function (f) { setError(f, ''); });
      bkState.method = null;
      bkState.slot = null;
      bkState.activeDay = null;
      methodGroup.querySelectorAll('[role="radio"]').forEach(function (r, i) { r.setAttribute('aria-checked', 'false'); r.tabIndex = i ? -1 : 0; });
      addressField.hidden = true;
      customToggle.setAttribute('aria-expanded', 'false');
      customBody.hidden = true;
      weekNotice.hidden = true;
      showBookAlert('');
      bkState.slots = 'idle';
      bk.removeAttribute('data-dirty');
      updateSummary();
      showView('1');
    };

    bk.addEventListener('modal:open', function (e) {
      var opener = e.detail.opener;
      if (bkState.view === 'done') resetBooking();
      bkState.source = opener && opener.closest('.fab-chatbot') ? 'chatbot'
        : opener && opener.closest('#modal-simulator') ? 'simulator'
        : opener && opener.closest('.cta') ? 'closing-cta' : opener && opener.closest('.hero') ? 'hero' : 'landing';
      /* 선택 조건: 시뮬레이터에서 마지막으로 체험한 프리셋 값 → 없으면 기본값(직접 설정) */
      if (bkState.view === '1' && !bk.hasAttribute('data-dirty')) {
        applyCustom(PRESETS[lastExperience ? lastExperience.preset : 3].custom);
      }
      /* 일정 선택 단계에서 다시 열면 마감 시간을 새로 불러옴 */
      if (bkState.view === '2') loadSlots(true);
    });

    bk.addEventListener('modal:close', function (e) {
      /* 완료 화면에서 닫으면(나중에 볼게요 · 닫기 · ESC · 오버레이) 랜딩 + 완료 토스트 */
      if (bkState.view === 'done' && e.detail.reason !== 'switch') {
        Kona.toast('상담 예약이 완료됐어요', 'success');
        resetBooking();
      }
    });

    applyCustom(PRESETS[3].custom);
    updateSummary();

    /* ?action=booking|simulator — 다른 화면 챗봇의 [상담 예약하기]·[무료로 체험하기]에서 넘어왔을 때 바로 열기
       (새로고침해도 다시 안 열리게 주소에서 뺌). &source=chatbot이면 opener를 FAB로 → 유입 경로 "chatbot", 닫으면 FAB로 포커스 */
    var params = new URLSearchParams(window.location.search);
    var action = params.get('action');
    if (action === 'booking' || (action === 'simulator' && sim)) {
      var url = new URL(window.location.href);
      url.searchParams.delete('action');
      url.searchParams.delete('source');
      history.replaceState(null, '', url);
      Kona.openModal('modal-' + action, params.get('source') === 'chatbot' ? document.querySelector('.fab-chatbot') : null);
    }
  }

  /* =======================================================
     04 통합 로그인
     ======================================================= */
  var lg = document.getElementById('modal-login');
  if (lg) {
    var lgForm = lg.querySelector('#login-form');
    var roleGroup = lg.querySelector('[data-login-role]');
    var helpEl = lg.querySelector('[data-login-help]');
    var alertEl = lg.querySelector('[data-login-alert]');
    var alertTitle = alertEl.querySelector('.alert-box__title');
    var alertMsg = alertTitle.nextElementSibling;
    var ALERT_DEFAULT = alertMsg.textContent;
    var emailField = lg.querySelector('[data-field="email"]');
    var pwField = lg.querySelector('[data-field="password"]');
    var emailInput = emailField.querySelector('input');
    var pwInput = pwField.querySelector('input');
    var pwToggle = lg.querySelector('[data-pw-toggle]');
    var submitBtn = lg.querySelector('[data-login-submit]');
    var role = 'admin';

    /* 토글은 도움말 문구만 바꿈 */
    var HELP = {
      admin: '비밀번호를 모르시나요? 코나비즈 고객센터로 문의해주세요',
      employee: '비밀번호를 모르시나요? 회사 담당자에게 문의해주세요'
    };
    var SUBMIT_LABEL = submitBtn.textContent;
    var MSG_NETWORK = '일시적인 오류로 로그인하지 못했습니다. 잠시 후 다시 시도해주세요.';
    var MSG_EXPIRED = '로그인이 만료되었습니다. 다시 로그인해주세요.';

    var fieldError = function (field, msg) {
      field.classList.toggle('is-error', !!msg);
      field.querySelector('.field__error').textContent = msg || '';
      field.querySelector('.field__input').setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    var clearErrors = function () {
      fieldError(emailField, '');
      fieldError(pwField, '');
      alertEl.hidden = true;
    };
    /* 경고 박스 — 실패는 제목 + 서버 메시지, 만료 안내는 제목 없이 문구만 */
    var showAlert = function (msg, noTitle) {
      alertTitle.hidden = !!noTitle;
      alertMsg.textContent = msg || ALERT_DEFAULT;
      alertEl.hidden = false;
    };

    roleGroup.addEventListener('click', function (e) {
      var b = e.target.closest('[data-role]');
      if (!b) return;
      Kona.selectItem(roleGroup, b);
      role = b.getAttribute('data-role');
      helpEl.textContent = HELP[role];
      clearErrors();   /* 이메일은 유지, 오류 표시는 지움 */
    });

    [emailField, pwField].forEach(function (f) {
      f.querySelector('input').addEventListener('input', function () { if (f.classList.contains('is-error')) fieldError(f, ''); });
    });

    pwToggle.addEventListener('click', function () {
      var show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      pwToggle.setAttribute('aria-pressed', String(show));
      pwToggle.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
    });

    var setBusy = function (busy) {
      submitBtn.disabled = busy;
      submitBtn.textContent = busy ? '로그인 중…' : SUBMIT_LABEL;
      emailInput.disabled = busy;
      pwInput.disabled = busy;
      pwToggle.disabled = busy;
    };

    lgForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();
      var email = emailInput.value.trim();
      var pw = pwInput.value;
      /* 칸별 오류(제출 전) — 서버 요청 안 함 */
      var emailMsg = !email ? '이메일을 입력해주세요.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '이메일 형식을 확인해주세요.' : '';
      var pwMsg = pw ? '' : '비밀번호를 입력해주세요.';
      fieldError(emailField, emailMsg);
      fieldError(pwField, pwMsg);
      if (emailMsg || pwMsg) { (emailMsg ? emailInput : pwInput).focus(); return; }

      /* 탭(role)은 보내지 않음 — 서버가 실제 역할의 화면(redirect)을 알려줌 */
      setBusy(true);
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email, password: pw })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      }).then(function (r) {
        if (r.res.ok && r.data.redirect) {
          /* 비로그인 챗봇 대화는 계정에 합치지 않고 새 대화로 (공용 PC 대비) */
          if (window.KonaChat) window.KonaChat.clear(false);
          window.location.href = r.data.redirect;
          return;
        }
        /* 401(이메일·비밀번호) · 403(이용 중지)은 서버 문구, 그 밖은 일시적 오류 */
        var known = (r.res.status === 401 || r.res.status === 403) && typeof r.data.detail === 'string';
        fail(known ? r.data.detail : MSG_NETWORK);
      }).catch(function () {
        fail(MSG_NETWORK);
      });
    });

    /* 실패: 입력칸은 Error로 바꾸지 않고 경고 박스 하나. 이메일은 두고 비밀번호만 비움 */
    var fail = function (msg) {
      setBusy(false);
      showAlert(msg);
      pwInput.value = '';
      pwInput.focus();
    };

    /* ?login=1 — 보호 페이지에서 넘어왔을 때 바로 열기. &expired=1이면 만료 안내 (새로고침해도 다시 안 열리게 주소에서 뺌) */
    var lgParams = new URLSearchParams(window.location.search);
    if (lgParams.get('login') === '1') {
      var lgUrl = new URL(window.location.href);
      lgUrl.searchParams.delete('login');
      lgUrl.searchParams.delete('expired');
      history.replaceState(null, '', lgUrl);
      Kona.openModal('modal-login', null);
      if (lgParams.get('expired') === '1') showAlert(MSG_EXPIRED, true);
    }

    lg.addEventListener('modal:close', function () {
      clearErrors();
      pwInput.value = '';
      pwInput.type = 'password';
      pwToggle.setAttribute('aria-pressed', 'false');
      pwToggle.setAttribute('aria-label', '비밀번호 보기');
    });
  }

  /* =======================================================
     AI 기능 섹션 — 질문 칩: 챗봇을 열고 그 질문을 직접 입력과 같은 경로로 보냄
     (답변을 기다리는 중이면 KonaChat.ask가 보내지 않음 → 중복 전송 없음)
     ======================================================= */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chat-ask]');
    if (chip && window.KonaChat) window.KonaChat.ask(chip.textContent);
  });
})();
