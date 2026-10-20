/* =========================================================
   코나비즈 — admin.js (05 관리자 대시보드)
   인원·카드 숫자(활성 카드 · 발급 중 · 부서별 카드 수)는 /api/dashboard/summary, 사용액·예산·카테고리·결제 알림은 예시값
   ?sandbox=1은 API를 부르지 않고 예시 데이터(KonaMock)로
   ?state=empty → 계약 직후(임직원 0명) 빈 상태. DB에 임직원이 0명이어도 빈 상태
   ========================================================= */
(function () {
  'use strict';

  var D = KonaMock.admin;
  var A = KonaApp;
  var forceEmpty = A.state(['empty']) === 'empty';
  var sandbox = new URLSearchParams(window.location.search).get('sandbox') === '1';

  document.querySelector('[data-period]').textContent = D.period;

  /* 예시 데이터를 summary 응답 모양으로 */
  function mockSummary() {
    return {
      employees: { total: KonaMock.members.length },
      cards: { active: KonaMock.activeCards(), issuing: KonaMock.issuingCards() },
      departments: KonaMock.DEPTS.map(function (d) { return { name: d, active: KonaMock.activeCards(d), issuing: KonaMock.issuingCards(d) }; })
    };
  }

  if (sandbox) { draw(mockSummary()); return; }

  fetch('/api/dashboard/summary', { credentials: 'same-origin' }).then(function (res) {
    if (res.status === 401) return null;   /* 로그인 모달로 보내는 것은 app.js(/api/auth/me) */
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }).then(function (s) {
    if (s) draw(s);
  }).catch(function () {
    var main = document.querySelector('[data-metrics]');
    main.hidden = true;
    main.parentNode.insertBefore(A.loadError(function () { window.location.reload(); }), main);
  });

  function draw(s) {
    var empty = forceEmpty || s.employees.total === 0;

    /* ---------- 숫자 카드 4개 ----------
       활성 카드 = 사용 중(active)만, 발급 중은 단위 뒤에 "· 발급 중 3" (기존 metric-card__unit 그대로) */
    var used = D.departments.reduce(function (s, d) { return s + d.amount; }, 0);
    var issuing = empty ? 0 : s.cards.issuing;
    var metrics = [
      ['이번 달 사용액', empty ? 0 : used, '원'],
      ['이번 달 예산', D.budget, '원'],
      ['활성 카드 수', empty ? 0 : s.cards.active, '장', issuing ? '&nbsp;· 발급 중 ' + A.num(issuing) : ''],
      ['이번 달 차단 건수', empty ? 0 : D.blockedCount, '건']
    ];
    /* 4번째 값(발급 중)은 단위 span을 하나 더 — 칸이 좁으면(1024 4열) 통째로 다음 줄로 */
    document.querySelector('[data-metrics]').innerHTML = metrics.map(function (m) {
      return '<div class="metric-card"><p class="metric-card__label">' + m[0] + '</p>' +
        '<p class="metric-card__value"><span class="metric-card__num">' + A.num(m[1]) + '</span>' +
        '<span class="metric-card__unit">' + m[2] + '</span>' +
        (m[3] ? '<span class="metric-card__unit">' + m[3] + '</span>' : '') + '</p></div>';
    }).join('');

    var body = document.querySelector('[data-dashboard-body]');

    /* ---------- Empty: 첫 임직원 초대 안내 ---------- */
    if (empty) {
      var steps = [
        ['임직원 초대', '이름과 이메일만 입력하면 돼요'],
        ['카드 즉시 발급', '초대와 동시에 법인카드가 발급돼요'],
        ['임직원 첫 로그인', '전달받은 임시 비밀번호로 로그인해요']
      ];
      body.innerHTML =
        '<section class="empty-state empty-state--panel" aria-labelledby="empty-title">' +
          '<div class="empty-state__text"><h2 id="empty-title" class="empty-state__title">첫 임직원을 초대해보세요</h2>' +
          '<p class="empty-state__desc">카드가 발급되고 결제가 시작되면 부서별 현황과 예산 사용률을 여기서 볼 수 있어요.</p></div>' +
          '<ol class="empty-steps">' + steps.map(function (s, i) {
            return '<li class="empty-step"><span class="empty-step__num" aria-hidden="true">' + (i + 1) + '</span>' +
              '<p class="empty-step__title">' + s[0] + '</p><p class="empty-step__desc">' + s[1] + '</p></li>';
          }).join('') + '</ol>' +
          '<div class="empty-state__actions">' +
            '<a class="btn btn--secondary" href="admin-members.html?action=csv">CSV로 한 번에 등록</a>' +
            '<a class="btn btn--primary" href="admin-members.html?action=invite">임직원 초대하기</a>' +
          '</div>' +
        '</section>';
      return;
    }

    /* ---------- 부서별 카드 현황 (줄 클릭 → 임직원관리 해당 부서) — 카드 수는 사용 중(active)만, 금액은 예시 ---------- */
    var cardsOf = {};
    s.departments.forEach(function (d) { cardsOf[d.name] = d.active; });
    var dept = D.departments.map(function (d) {
      return '<li><a class="dept-row" href="admin-members.html?dept=' + encodeURIComponent(d.name) + '">' +
        '<span class="dept-row__name">' + d.name + '</span>' +
        '<span class="dept-row__value">카드 ' + A.num(cardsOf[d.name] || 0) + '장 · ' + A.won(d.amount) +
        '<img src="assets/icon-chevron-right-line.svg" alt="" width="20" height="20"></span></a></li>';
    }).join('');

    /* ---------- 카테고리별 지출 · 예산 사용률 ---------- */
    var cat = D.categories.map(function (c) {
      var pct = Math.round(c.used / c.budget * 100);
      return '<li class="cat-row">' +
        '<div class="cat-row__head"><span class="cat-row__name">' + c.name + '</span>' +
        '<span class="cat-row__amount">' + A.num(c.used) + ' / ' + A.won(c.budget) + '</span></div>' +
        '<div class="cat-row__bar"><div class="progress" role="progressbar" aria-label="' + c.name + ' 예산 사용률" ' +
        'aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><div class="progress__fill" style="width:' + pct + '%"></div></div>' +
        '<span class="cat-row__pct" aria-hidden="true">' + pct + '%</span></div></li>';
    }).join('');

    /* ---------- 최근 결제 알림 4건 ---------- */
    var alerts = D.alerts.map(function (a) {
      return '<li class="pay-row' + (a.ok ? '' : ' is-blocked') + '">' +
        '<img class="pay-row__icon" src="assets/' + (a.ok ? 'icon-check-green.svg' : 'icon-stop.svg') + '" alt="' + (a.ok ? '승인' : '차단') + '" width="20" height="20">' +
        '<div class="pay-row__text"><p class="pay-row__title">' + a.title + '</p><p class="pay-row__meta">' + a.meta + '</p></div></li>';
    }).join('');

    body.outerHTML =
      '<section class="panel" aria-labelledby="dept-title">' +
        '<h2 id="dept-title" class="panel__title">부서별 카드 현황</h2>' +
        '<ul class="dept-list">' + dept + '</ul>' +
      '</section>' +
      '<div class="dash-bottom">' +
        '<section class="panel dash-bottom__cat" aria-labelledby="cat-title">' +
          '<h2 id="cat-title" class="panel__title">카테고리별 지출 · 예산 사용률</h2>' +
          '<ul class="cat-list">' + cat + '</ul>' +
          '<div class="cat-divider" aria-hidden="true"></div>' +
          '<p class="cat-expense"><span class="cat-expense__label">' + D.expense.name + '</span>' +
          '<span class="cat-expense__value">' + A.won(D.expense.used) + '</span></p>' +
        '</section>' +
        '<section class="panel dash-bottom__alert" aria-labelledby="alert-title">' +
          '<h2 id="alert-title" class="panel__title">최근 결제 알림</h2>' +
          '<ul class="pay-list">' + alerts + '</ul>' +
        '</section>' +
      '</div>';
  }
})();
