/* =========================================================
   코나비즈 — employee.js (06 임직원 마이페이지)
   카드·포인트·결제내역은 /api/me/card (로그인한 본인 것만)
   ?sandbox=1 · ?state= 미리보기는 API를 부르지 않고 예시 데이터(KonaMock, 김민준)로
   ?state= suspended · issuing · no-payments · loading · error
   ========================================================= */
(function () {
  'use strict';

  var D = KonaMock.employee;
  var A = KonaApp;
  var PAGE = 5;   /* 처음 5건, [더 보기]마다 10건씩 */
  var sandbox = new URLSearchParams(window.location.search).get('sandbox') === '1';

  var cardArea = document.querySelector('[data-card-area]');
  var points = document.querySelector('[data-points]');
  var history = document.querySelector('[data-history]');
  var paytestOn = false;   /* [결제 테스트] 버튼 — 로그인한 본인 화면에서만 (Sandbox · ?state= 미리보기는 없음, DB에 안 씀) */
  var REVIEW_MSG = 'AI 확신도가 낮아 관리자 확인이 필요해요';

  /* 화면에 그리는 모양 { last4, holder, status, balances{4종}, total, expense, payments[{date, merchant, pocket, amount, blocked}] } */

  /* 예시 데이터 → 화면 모양 (Sandbox · ?state= 미리보기) */
  function mockCard(state) {
    var noPay = state === 'issuing' || state === 'no-payments';
    var payments = noPay ? [] : D.payments;
    var b = KonaMock.balances(D.start, payments);
    return {
      last4: D.card.last4, holder: D.card.holder,
      status: state === 'suspended' || state === 'issuing' ? state : 'active',
      balances: b, total: b.meal + b.fitness + b.welfare, expense: b.expense,
      payments: payments
    };
  }

  /* /api/me/card 응답 → 화면 모양. 날짜는 KST ISO 문자열의 월/일 */
  function fromApi(r) {
    var bal = {};
    Object.keys(r.points).forEach(function (k) { bal[k] = r.points[k].balance; });
    return {
      last4: r.last4, holder: r.holder, status: r.status,
      balances: bal, total: r.summary.remaining, expense: r.summary.expense,
      payments: r.transactions.map(function (t) {
        return {
          date: t.paid_at.slice(5, 10).replace('-', '/'), merchant: t.merchant, pocket: t.pocket, amount: t.amount,
          blocked: t.status === 'blocked' ? (t.blocked_reason || '결제가 차단됐어요') : null,
          review: t.status === 'review' ? (t.blocked_reason || REVIEW_MSG) : null,
          ai: t.ai || null
        };
      })
    };
  }

  /* AI 판별기 — 결과에 그 포인트의 남은 금액 (불러오기 전·실패면 표시 안 함). Sandbox도 실제 API */
  var current = null;
  KonaClassifier.mount(document.querySelector('[data-classifier]'), {
    balances: function () { return current && current.balances; }
  });

  /* view: 'loading' | 'error' | 화면 모양. onRetry는 실패 화면의 [다시 시도] */
  function render(view, onRetry) {
    current = typeof view === 'object' ? view : null;
    renderCard(view);
    renderPoints(view, onRetry);
    renderHistory(view, onRetry);
  }

  /* ---------- 법인카드 ---------- */
  function renderCard(view) {
    if (view === 'loading') {
      cardArea.innerHTML = '<div class="skeleton skeleton--card" aria-hidden="true"></div>';
      return;
    }
    if (view === 'error') { cardArea.innerHTML = ''; return; }
    if (view.status === 'issuing') {
      cardArea.innerHTML =
        '<div class="corp-card corp-card--issuing">' +
          '<img src="assets/icon-card.svg" alt="" width="24" height="24">' +
          '<p class="corp-card__issuing-title">카드를 발급하고 있어요</p>' +
          '<p class="corp-card__issuing-desc">발급이 끝나면 여기에 카드가 표시돼요</p>' +
        '</div>';
      return;
    }
    var suspended = view.status === 'suspended';
    cardArea.innerHTML =
      '<div class="corp-card' + (suspended ? ' is-suspended' : '') + '">' +
        '<div class="corp-card__top"><p class="corp-card__name">코나비즈 법인카드</p>' +
        (suspended ? '<span class="badge-status badge-status--suspended">정지</span>'
                   : '<span class="badge-status badge-status--active">사용 중</span>') + '</div>' +
        '<div class="corp-card__bottom">' +
          '<p class="corp-card__number"><span aria-hidden="true">•••• •••• •••• </span>' +
          '<span class="visually-hidden">카드 마지막 네 자리 </span>' + A.esc(view.last4) + '</p>' +
          '<p class="corp-card__holder">' + A.esc(view.holder) + '</p>' +
        '</div>' +
      '</div>' +
      (suspended
        ? '<div class="alert-box" role="status"><img class="alert-box__icon" src="assets/icon-alert-danger.svg" alt="" width="20" height="20">' +
          '<div class="alert-box__text"><p class="alert-box__title">카드가 정지됐어요</p><p>다시 사용하려면 회사 담당자에게 문의해주세요.</p></div></div>'
        : '<p class="card-help" aria-disabled="true">카드 분실신고 · 잠금 <span class="card-help__soon">준비 중</span></p>');
  }

  /* ---------- 이번 달 남은 포인트 (합계에서 법인경비P 제외) ----------
     합계는 늘 크게, [카테고리별 남은 금액](aria-expanded)으로 4종 접기·펼치기.
     기본값은 페이지를 열 때 화면 폭으로 한 번 정함 — PC(768 이상) 펼침 · 모바일(767 이하) 접힘.
     사용자가 바꾼 상태는 결제 테스트 뒤 다시 그려도 유지 (새로고침하면 다시 기본값) */
  var pointsOpen = !window.matchMedia('(max-width: 767px)').matches;

  function renderPoints(view, onRetry) {
    if (view === 'loading') {
      points.className = 'skeleton skeleton--points';
      points.setAttribute('aria-hidden', 'true');
      points.innerHTML = '';
      return;
    }
    points.className = 'panel';
    points.removeAttribute('aria-hidden');
    var head = '<div class="points-head"><h2 id="points-title" class="points-head__label">이번 달 남은 포인트</h2>';
    if (view === 'error') {
      points.innerHTML = head + '</div>';
      points.appendChild(A.loadError(onRetry));
      return;
    }
    var b = view.balances;
    var row = function (label, v) {
      return '<li class="info-row"><span class="info-row__label">' + label + '</span><span class="info-row__value">' + A.won(v) + '</span></li>';
    };
    points.innerHTML = head + '<p class="points-head__total">' + A.won(view.total) + '</p></div>' +
      '<button class="points-toggle" type="button" aria-expanded="' + pointsOpen + '" aria-controls="points-detail">' +
        '카테고리별 남은 금액<img src="assets/icon-caret-down.svg" alt="" width="20" height="20"></button>' +
      '<div id="points-detail" class="points-detail"' + (pointsOpen ? '' : ' hidden') + '>' +
        '<ul class="info-list points-list">' + row('식대P', b.meal) + row('체력단련P', b.fitness) + row('복지P', b.welfare) + '</ul>' +
        '<div class="points-divider" aria-hidden="true"></div>' +
        '<p class="info-row points-expense"><span class="info-row__label">법인경비P (별도 예산)</span><span class="info-row__value">' + A.won(view.expense) + '</span></p>' +
      '</div>';
    var toggle = points.querySelector('.points-toggle');
    toggle.addEventListener('click', function () {
      pointsOpen = !pointsOpen;
      toggle.setAttribute('aria-expanded', String(pointsOpen));
      points.querySelector('#points-detail').hidden = !pointsOpen;
    });
  }

  /* ---------- 최근 결제내역 (최신순) ---------- */
  /* AI 분류 줄 — seed 때 모델로 계산해 저장한 값 (없으면 줄 없음). 규칙 판정은 "제한 업종 규칙" */
  function aiLine(ai) {
    if (!ai) return '';
    /* 확신도는 판별기와 같이 99%까지만 */
    var text = ai.source === 'rule' ? '제한 업종 규칙' : 'AI 분류 · ' + A.esc(ai.industry) +
      ' · 확신도 ' + Math.min(99, Math.round(ai.confidence * 100)) + '%' + (ai.level === 'low' ? ' · 확실하지 않음' : '');
    return '<p class="pay-row__ai"><span class="badge-status badge-status--ai badge-status--xs" aria-hidden="true">AI</span>' +
      '<span>' + (ai.source === 'rule' ? '<span class="visually-hidden">AI </span>' : '') + text + '</span></p>';
  }

  /* 상태: 승인 · 차단 · 확인 필요(review — 결제 테스트에서 AI 확신도가 낮을 때, 차감 없음) */
  function payRow(p) {
    var blocked = !!p.blocked;
    var review = !blocked && !!p.review;
    var icon = blocked ? 'icon-stop.svg' : review ? 'icon-alert-ink.svg' : 'icon-check-green.svg';
    var label = blocked ? '차단' : review ? '확인 필요' : '승인';
    var reason = blocked ? p.blocked : review ? p.review : '';
    return '<li class="pay-row' + (blocked ? ' is-blocked' : review ? ' is-review' : '') + '">' +
      '<img class="pay-row__icon" src="assets/' + icon + '" alt="' + label + '" width="20" height="20">' +
      '<div class="pay-row__text"><p class="pay-row__title">' + A.esc(p.merchant) + '</p>' +
      '<p class="pay-row__meta">' + p.date + ' · ' + (blocked || review ? label : KonaMock.POCKET_NAME[p.pocket]) + '</p>' +
      (reason ? '<p class="pay-row__reason">' + A.esc(reason) + '</p>' : '') + aiLine(p.ai) + '</div>' +
      '<p class="pay-row__amount">' + A.won(p.amount) + '</p></li>';
  }

  function renderHistory(view, onRetry) {
    var title = '<h2 id="history-title" class="panel__title">최근 결제내역</h2>';
    if (paytestOn && typeof view === 'object') {
      title = '<div class="history-head">' + title +
        '<button class="btn btn--secondary" type="button" data-open="paytest" aria-haspopup="dialog">결제 테스트</button></div>';
    }
    if (view === 'loading') {
      history.innerHTML = title + '<div class="skeleton skeleton--history" aria-hidden="true"></div>';
      history.setAttribute('aria-busy', 'true');
      return;
    }
    history.removeAttribute('aria-busy');
    if (view === 'error') {
      history.innerHTML = title;
      history.appendChild(A.loadError(onRetry));
      return;
    }
    var payments = view.payments;
    if (!payments.length) {
      history.innerHTML = title +
        '<div class="empty-state"><div class="empty-state__text">' +
        (paytestOn
          ? '<p class="empty-state__title">아직 결제내역이 없어요</p><p class="empty-state__desc">[결제 테스트]로 결제해 보세요.</p>'
          : '<p class="empty-state__title">아직 결제 내역이 없어요</p><p class="empty-state__desc">카드로 결제하면 여기에 바로 표시돼요</p>') +
        '</div></div>';
      return;
    }

    var shown = Math.min(PAGE, payments.length);
    history.innerHTML = title + '<ul class="pay-list" data-pay-list>' + payments.slice(0, shown).map(payRow).join('') + '</ul>' +
      (shown < payments.length ? '<button class="btn btn--secondary btn--block" type="button" data-more>더 보기</button>' : '');

    var more = history.querySelector('[data-more]');
    if (!more) return;
    more.addEventListener('click', function () {
      var list = history.querySelector('[data-pay-list]');
      var next = payments.slice(shown, shown + 10);
      var firstNew = list.children.length;
      list.insertAdjacentHTML('beforeend', next.map(payRow).join(''));
      shown += next.length;
      if (shown >= payments.length) {   /* 끝나면 버튼 대신 안내 */
        var end = document.createElement('p');
        end.className = 'history-end';
        end.setAttribute('role', 'status');
        end.textContent = '모든 내역을 불러왔어요';
        more.replaceWith(end);
      }
      /* 새로 붙은 첫 행으로 포커스를 옮길 수 있게 */
      var first = list.children[firstNew];
      if (first) { first.tabIndex = -1; first.focus({ preventScroll: false }); }
    });
  }

  /* ---------- 결제 테스트 (시연용) 모달 — POST /api/payments/test ----------
     결제내역 제목 줄 [결제 테스트](data-open) → #modal-paytest. 열 때마다 입력·결과 초기화, 결제 중에는 data-locked
     응답 { transaction(결제내역 모양), points, summary } → 결과 화면 + 뒤의 포인트 · 결제내역 즉시 갱신(새 항목 맨 위)
     닫으면 새 항목 2초 강조 + 포커스는 [결제 테스트]로 (결제내역을 다시 그려 처음 연 버튼이 바뀌므로 직접 찾음)
     가맹점 예시 칩(랜딩 판별기와 같은 4개)은 누르면 입력칸만 채움. 금액은 직접 입력만 */
  var PT_MERCHANTS = ['달빛우동 성수점', '애니타임피트니스', '새벽별문구', '블루문 유흥주점'];
  var PT_NAME_MAX = 40, PT_MIN = 100, PT_MAX = 1000000;   /* backend routers/payments.py와 같은 값 */

  var ptModal = document.getElementById('modal-paytest');
  var ptForm = ptModal.querySelector('[data-paytest-form]');
  var ptMerchant = ptModal.querySelector('#paytest-merchant');
  var ptAmount = ptModal.querySelector('#paytest-amount');
  var ptSubmit = ptModal.querySelector('[data-paytest-submit]');
  var ptAlert = ptModal.querySelector('[data-paytest-alert]');
  var ptResult = ptModal.querySelector('[data-paytest-result]');
  var ptFacts = ptModal.querySelector('[data-paytest-facts]');
  var ptLive = ptModal.querySelector('[data-paytest-live]');
  var ptBusy = false;
  var ptNew = false;   /* 이번에 연 동안 결제가 기록됐는지 — 닫을 때 맨 위 항목 강조 */

  ptModal.querySelector('[data-paytest-chips="merchant"]').innerHTML = PT_MERCHANTS.map(function (m) {
    return '<button class="chip-toggle chip-quick" type="button" data-pt-merchant>' + A.esc(m) + '</button>';
  }).join('');
  var ptChips = ptModal.querySelectorAll('.chip-quick');

  function ptView(name) {
    ptModal.querySelectorAll('[data-paytest-view]').forEach(function (v) {
      v.hidden = v.getAttribute('data-paytest-view') !== name;
    });
  }

  function ptFieldError(key, msg) {
    var field = ptModal.querySelector('[data-paytest-field="' + key + '"]');
    field.classList.toggle('is-error', !!msg);
    field.querySelector('.field__error').textContent = msg || '';
    field.querySelector('.field__input').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* 입력 화면 처음 상태 (값 비움) */
  function ptReset() {
    ptForm.reset();
    ptFieldError('merchant', '');
    ptFieldError('amount', '');
    ptAlert.hidden = true;
    ptLive.textContent = '';
    ptView('form');
  }

  /* 화면 검사 — 서버 규칙과 같음. 금액은 쉼표 허용 */
  function ptValidate() {
    var name = ptMerchant.value.trim();
    var raw = ptAmount.value.replace(/[,\s]/g, '').replace(/원$/, '');
    var errors = {};
    if (!name) errors.merchant = '가맹점 이름을 입력해주세요.';
    else if (name.length > PT_NAME_MAX) errors.merchant = '가맹점 이름은 ' + PT_NAME_MAX + '자까지 입력할 수 있어요.';
    if (!raw) errors.amount = '금액을 입력해주세요.';
    else if (!/^\d+$/.test(raw)) errors.amount = '금액은 숫자로만 입력해주세요.';
    else if (+raw < PT_MIN || +raw > PT_MAX) errors.amount = A.num(PT_MIN) + '원부터 ' + A.num(PT_MAX) + '원까지 입력할 수 있어요.';
    return { values: { merchant: name, amount: +raw }, errors: errors };
  }

  function ptShowErrors(errors) {
    ptFieldError('merchant', errors.merchant);
    ptFieldError('amount', errors.amount);
    if (errors.merchant) ptMerchant.focus();
    else if (errors.amount) ptAmount.focus();
  }

  /* 로그인 버튼과 같은 방식: 비활성 + "결제 중…". 그동안 X · 바깥 클릭 · ESC로 닫히지 않음 */
  function ptSetBusy(on) {
    ptBusy = on;
    ptSubmit.disabled = on;
    ptSubmit.textContent = on ? '결제 중…' : '결제하기';
    ptMerchant.disabled = on;
    ptAmount.disabled = on;
    ptChips.forEach(function (c) { c.disabled = on; });
    ptForm.closest('[data-paytest-view]').querySelectorAll('[data-modal-close]').forEach(function (b) { b.disabled = on; });   /* X · [취소] */
    ptModal.toggleAttribute('data-locked', on);
  }

  function ptFact(label, value) {
    return '<li class="info-row"><span class="info-row__label">' + label + '</span><span class="info-row__value">' + value + '</span></li>';
  }

  function ptDone(r) {
    var t = r.transaction;
    /* 모달 뒤 포인트 카드 · 결제내역 갱신 (결제내역은 처음 5건부터 다시 그림) */
    var bal = {};
    Object.keys(r.points).forEach(function (k) { bal[k] = r.points[k].balance; });
    current.balances = bal;
    current.total = r.summary.remaining;
    current.expense = r.summary.expense;
    current.payments = [fromApi({ points: r.points, summary: r.summary, transactions: [t] }).payments[0]].concat(current.payments);
    renderPoints(current);
    renderHistory(current);
    ptNew = true;

    var pocket = t.pocket && KonaMock.POCKET_NAME[t.pocket].replace(/P$/, ' 포인트');
    var cls, icon, headline;
    if (t.status === 'approved') {
      cls = 'approved'; icon = 'icon-check-green.svg'; headline = pocket + '에서 ' + A.won(t.amount) + '이 차감됐어요';
    } else if (t.status === 'review') {
      cls = 'review'; icon = 'icon-alert-ink.svg'; headline = 'AI 확신도가 낮아 관리자 확인이 필요해요 (차감 안 됨)';
    } else {
      cls = 'blocked'; icon = 'icon-stop-danger.svg'; headline = '결제가 차단됐어요 · ' + (t.blocked_reason || '결제할 수 없어요');
    }
    ptResult.className = 'result-box paytest-result is-' + cls;
    ptResult.innerHTML = '<p class="paytest-result__headline"><img src="assets/' + icon + '" alt="" width="20" height="20">' + A.esc(headline) + '</p>';

    var ai = t.ai;
    ptFacts.innerHTML =
      ptFact('상태', cls === 'approved' ? '승인' : cls === 'review' ? '확인 필요' : '차단') +
      ptFact('가맹점', A.esc(t.merchant)) +
      ptFact('금액', A.won(t.amount)) +
      (ai ? ptFact('AI 분류', ai.source === 'rule' ? '제한 업종 규칙'
        : A.esc(ai.industry) + ' · 확신도 ' + Math.min(99, Math.round(ai.confidence * 100)) + '%') : '') +
      (cls === 'approved' ? ptFact('차감', pocket + ' ' + A.won(t.amount)) : ptFact('사유', A.esc(t.blocked_reason || '-')));

    ptView('result');
    ptModal.querySelector('[data-paytest-ok]').focus();
    ptLive.textContent = headline;   /* 보이는 결과 문장을 스크린리더가 읽음 */
  }

  ptForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (ptBusy || !current) return;
    var v = ptValidate();
    if (v.errors.merchant || v.errors.amount) { ptShowErrors(v.errors); return; }
    ptShowErrors({});
    ptAlert.hidden = true;
    ptSetBusy(true);
    fetch('/api/payments/test', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v.values)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {   /* 로그인 만료 — app.js와 같은 방식 */
          var expired = res.headers.get('X-Auth-Error') === 'expired';
          window.location.replace('index.html?login=1' + (expired ? '&expired=1' : ''));
          return;
        }
        ptSetBusy(false);   /* 비활성이던 입력칸으로 포커스를 옮길 수 있게 먼저 */
        if (res.ok) { ptDone(data); return; }
        if (res.status === 422 && data.errors) { ptShowErrors(data.errors); return; }   /* 입력값 그대로 */
        ptAlert.hidden = false;   /* 429 · 5xx — 입력값 그대로 */
        ptSubmit.focus();
      });
    }).catch(function () {   /* 네트워크 오류 — 입력값 유지 */
      ptSetBusy(false);
      ptAlert.hidden = false;
      ptSubmit.focus();
    });
  });

  [ptMerchant, ptAmount].forEach(function (input) {
    input.addEventListener('input', function () {
      var field = input.closest('.field');
      if (field.classList.contains('is-error')) ptFieldError(field.getAttribute('data-paytest-field'), '');
    });
  });
  ptModal.querySelectorAll('[data-pt-merchant]').forEach(function (c) {
    c.addEventListener('click', function () { ptMerchant.value = c.textContent; ptFieldError('merchant', ''); });
  });
  ptModal.querySelector('[data-paytest-again]').addEventListener('click', function () {
    ptReset();
    ptMerchant.focus();
  });

  ptModal.addEventListener('modal:open', function () {
    ptNew = false;
    ptReset();
  });
  ptModal.addEventListener('modal:close', function () {
    var btn = history.querySelector('[data-open="paytest"]');
    if (btn) btn.focus({ preventScroll: true });
    var row = ptNew && history.querySelector('.pay-row');
    if (!row) return;
    row.classList.add('is-new');
    setTimeout(function () { row.classList.remove('is-new'); }, 2000);
  });

  /* ---------- 불러오기 ---------- */
  function load() {
    render('loading');
    fetch('/api/me/card', { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 401) return null;   /* 로그인 모달로 보내는 것은 app.js(/api/auth/me) */
      if (!res.ok) throw new Error(String(res.status));   /* 403 · 404(카드 없음) · 5xx */
      return res.json();
    }).then(function (r) {
      if (!r) return;
      paytestOn = true;   /* 결제내역 제목 줄 버튼 · 빈 상태 문구가 이 값을 보므로 render 전에 */
      render(fromApi(r));
    }).catch(function () {
      render('error', load);
    });
  }

  var state = A.state(['suspended', 'issuing', 'no-payments', 'loading', 'error']);
  if (sandbox || state !== 'default') {
    var preview = function () { render(mockCard('default')); };
    render(state === 'loading' || state === 'error' ? state : mockCard(state), preview);
  } else {
    load();
  }
})();
