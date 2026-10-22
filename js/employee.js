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
  var paytest = document.querySelector('[data-paytest]');   /* 로그인한 본인 화면에서만 보임 (Sandbox · 미리보기는 hidden) */
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

  /* ---------- 이번 달 남은 포인트 (합계에서 법인경비P 제외) ---------- */
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
      '<ul class="info-list points-list">' + row('식대P', b.meal) + row('체력단련P', b.fitness) + row('복지P', b.welfare) + '</ul>' +
      '<div class="points-divider" aria-hidden="true"></div>' +
      '<p class="info-row points-expense"><span class="info-row__label">법인경비P (별도 예산)</span><span class="info-row__value">' + A.won(view.expense) + '</span></p>';
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
        (paytest.hidden
          ? '<p class="empty-state__title">아직 결제 내역이 없어요</p><p class="empty-state__desc">카드로 결제하면 여기에 바로 표시돼요</p>'
          : '<p class="empty-state__title">아직 결제내역이 없어요</p><p class="empty-state__desc">위에서 테스트 결제를 해 보세요.</p>') +
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

  /* ---------- 결제 테스트 (시연용) — POST /api/payments/test ----------
     응답 { transaction(결제내역 모양), points, summary } → 새로고침 없이 포인트 · 결제내역 맨 위 갱신
     예시 칩은 누르면 입력칸만 채움(결제는 버튼으로). 가맹점 칩은 랜딩 판별기와 같은 4개 */
  var PT_MERCHANTS = ['달빛우동 성수점', '애니타임피트니스', '새벽별문구', '블루문 유흥주점'];
  var PT_AMOUNTS = [9000, 30000];
  var PT_NAME_MAX = 40, PT_MIN = 100, PT_MAX = 1000000;   /* backend routers/payments.py와 같은 값 */
  var PT_FAIL = '결제를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  var PT_IDLE = paytest.querySelector('[data-paytest-result]').innerHTML;

  var ptForm = paytest.querySelector('[data-paytest-form]');
  var ptMerchant = paytest.querySelector('#paytest-merchant');
  var ptAmount = paytest.querySelector('#paytest-amount');
  var ptSubmit = paytest.querySelector('.paytest__submit');
  var ptResult = paytest.querySelector('[data-paytest-result]');
  var ptBusy = false;

  paytest.querySelector('[data-paytest-chips="merchant"]').innerHTML = PT_MERCHANTS.map(function (m) {
    return '<button class="chip-toggle chip-quick" type="button" data-pt-merchant>' + A.esc(m) + '</button>';
  }).join('');
  paytest.querySelector('[data-paytest-chips="amount"]').innerHTML = PT_AMOUNTS.map(function (n) {
    return '<button class="chip-toggle chip-quick" type="button" data-pt-amount="' + n + '">' + A.won(n) + '</button>';
  }).join('');
  var ptChips = paytest.querySelectorAll('.chip-quick');

  function ptFieldError(key, msg) {
    var field = paytest.querySelector('[data-paytest-field="' + key + '"]');
    field.classList.toggle('is-error', !!msg);
    field.querySelector('.field__error').textContent = msg || '';
    field.querySelector('.field__input').setAttribute('aria-invalid', msg ? 'true' : 'false');
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

  function ptSetBusy(on) {
    ptBusy = on;
    ptSubmit.disabled = on;
    ptSubmit.textContent = on ? '결제 중…' : '테스트 결제하기';
    ptMerchant.disabled = on;
    ptAmount.disabled = on;
    ptChips.forEach(function (c) { c.disabled = on; });
    if (on) ptResult.setAttribute('aria-busy', 'true'); else ptResult.removeAttribute('aria-busy');
  }

  function ptShow(cls, icon, headline, detail) {
    ptResult.className = 'result-box paytest__result' + (cls ? ' is-' + cls : '');
    ptResult.innerHTML = '<p class="paytest__headline"><img src="assets/' + icon + '" alt="" width="20" height="20">' + A.esc(headline) + '</p>' +
      (detail ? '<p class="paytest__detail">' + detail + '</p>' : '');
  }

  function ptDone(r) {
    var t = r.transaction;
    /* 포인트 카드 · 결제내역 갱신 (결제내역은 처음 5건부터 다시 그림) */
    var bal = {};
    Object.keys(r.points).forEach(function (k) { bal[k] = r.points[k].balance; });
    current.balances = bal;
    current.total = r.summary.remaining;
    current.expense = r.summary.expense;
    current.payments = [fromApi({ points: r.points, summary: r.summary, transactions: [t] }).payments[0]].concat(current.payments);
    renderPoints(current);
    renderHistory(current);

    var ai = t.ai;
    var detail = A.esc(t.merchant) + ' · ' + A.won(t.amount) +
      (ai ? ' · ' + (ai.source === 'rule' ? '제한 업종 규칙' : 'AI 분류 ' + A.esc(ai.industry) + ' ' + Math.min(99, Math.round(ai.confidence * 100)) + '%') : '');
    if (t.status === 'approved') {
      ptShow('approved', 'icon-check-green.svg', KonaMock.POCKET_NAME[t.pocket].replace(/P$/, ' 포인트') + '에서 ' + A.won(t.amount) + '이 차감됐어요', detail);
    } else if (t.status === 'review') {
      ptShow('review', 'icon-alert-ink.svg', 'AI 확신도가 낮아 관리자 확인이 필요해요 (차감 안 됨)', detail);
    } else {
      ptShow('blocked', 'icon-stop-danger.svg', '결제가 차단됐어요 · ' + (t.blocked_reason || '결제할 수 없어요'), detail);
    }
  }

  ptForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (ptBusy || !current) return;
    var v = ptValidate();
    if (v.errors.merchant || v.errors.amount) { ptShowErrors(v.errors); return; }
    ptShowErrors({});
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
        if (res.status === 422 && data.errors) {   /* 입력값은 그대로, 오류 칸으로 포커스 */
          ptResult.className = 'result-box paytest__result';
          ptResult.innerHTML = PT_IDLE;
          ptShowErrors(data.errors);
          return;
        }
        if (res.ok) ptDone(data);
        else ptShow('fail', 'icon-alert.svg', res.status === 429 && typeof data.detail === 'string' ? data.detail : PT_FAIL);
        ptSubmit.focus();
      });
    }).catch(function () {   /* 네트워크 오류 — 입력값 유지 */
      ptSetBusy(false);
      ptShow('fail', 'icon-alert.svg', PT_FAIL);
      ptSubmit.focus();
    });
  });

  [ptMerchant, ptAmount].forEach(function (input) {
    input.addEventListener('input', function () {
      var field = input.closest('.field');
      if (field.classList.contains('is-error')) ptFieldError(field.getAttribute('data-paytest-field'), '');
    });
  });
  paytest.querySelectorAll('[data-pt-merchant]').forEach(function (c) {
    c.addEventListener('click', function () { ptMerchant.value = c.textContent; ptFieldError('merchant', ''); });
  });
  paytest.querySelectorAll('[data-pt-amount]').forEach(function (c) {
    c.addEventListener('click', function () { ptAmount.value = A.num(+c.getAttribute('data-pt-amount')); ptFieldError('amount', ''); });
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
      paytest.hidden = false;   /* 빈 상태 문구가 이 값을 보므로 render 전에 */
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
