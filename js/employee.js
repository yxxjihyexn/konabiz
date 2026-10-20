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
          blocked: t.status === 'blocked' ? (t.blocked_reason || '결제가 차단됐어요') : null
        };
      })
    };
  }

  /* view: 'loading' | 'error' | 화면 모양. onRetry는 실패 화면의 [다시 시도] */
  function render(view, onRetry) {
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
  function payRow(p) {
    var blocked = !!p.blocked;
    return '<li class="pay-row' + (blocked ? ' is-blocked' : '') + '">' +
      '<img class="pay-row__icon" src="assets/' + (blocked ? 'icon-stop.svg' : 'icon-check-green.svg') + '" alt="' + (blocked ? '차단' : '승인') + '" width="20" height="20">' +
      '<div class="pay-row__text"><p class="pay-row__title">' + A.esc(p.merchant) + '</p>' +
      '<p class="pay-row__meta">' + p.date + ' · ' + (blocked ? '차단' : KonaMock.POCKET_NAME[p.pocket]) + '</p>' +
      (blocked ? '<p class="pay-row__reason">' + A.esc(p.blocked) + '</p>' : '') + '</div>' +
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
        '<p class="empty-state__title">아직 결제 내역이 없어요</p>' +
        '<p class="empty-state__desc">카드로 결제하면 여기에 바로 표시돼요</p></div></div>';
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

  /* ---------- 불러오기 ---------- */
  function load() {
    render('loading');
    fetch('/api/me/card', { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 401) return null;   /* 로그인 모달로 보내는 것은 app.js(/api/auth/me) */
      if (!res.ok) throw new Error(String(res.status));   /* 403 · 404(카드 없음) · 5xx */
      return res.json();
    }).then(function (r) {
      if (r) render(fromApi(r));
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
