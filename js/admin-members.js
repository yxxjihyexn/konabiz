/* =========================================================
   코나비즈 — admin-members.js (08 임직원관리)
   상태 필터 · 검색 · 페이지 이동 · 초대 · CSV 일괄 등록 · ⋯ 메뉴(임시 비밀번호 재발급 · 정지 · 정지 해제 · 회수)
   목록·초대·재발급·정지·해제·회수는 /api/members (DB 저장). 상태 전이는 backend/app/member_rules.py
   목록은 회사 전체를 한 번에 받고 상태·검색·부서·페이지는 화면에서 거름 (칩 개수·즉시 검색 유지)
   ?dept=개발팀 → 부서 필터 / ?action=invite|csv → 모달 바로 열기
   CSV 일괄 등록은 아직 예시 동작 — 화면에만 추가되고 저장하지 않음 (새로고침하면 사라짐)
   ========================================================= */
(function () {
  'use strict';

  var A = KonaApp;
  var M = KonaMock;
  var esc = A.esc;
  var params = new URLSearchParams(window.location.search);

  var members = [];
  var loadState = 'loading';   /* loading | ready | error */
  var csvId = 0;               /* CSV 예시 행 id (local) */
  var busyId = null;           /* 요청 중인 행 — 그 행의 ⋯ 버튼 비활성 */
  var PER_PAGE = 10;

  var MSG_FAIL = '일시적인 오류로 처리하지 못했어요. 잠시 후 다시 시도해주세요.';

  /* ---------- API ----------
     응답 { status, ok, data }. 401(로그인 만료·정지)은 로그인 모달로 보냄 (app.js와 같은 방식) */
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          var expired = res.headers.get('X-Auth-Error') === 'expired';
          window.location.replace('index.html?login=1' + (expired ? '&expired=1' : ''));
        }
        return { status: res.status, ok: res.ok, data: data };
      });
    });
  }
  function detail(r) { return typeof r.data.detail === 'string' ? r.data.detail : MSG_FAIL; }

  /* "2026-10-16T09:12:00+09:00" → "2026.10.16" */
  function fromApi(m) {
    return {
      id: m.id, name: m.name, email: m.email, dept: m.dept, last4: m.last4, status: m.status,
      invited: m.invited_at ? m.invited_at.slice(0, 10).replace(/-/g, '.') : ''
    };
  }

  /* 목록 다시 받기 — quiet면 지금 목록을 둔 채로 받아서 바꿈 (동작 후 갱신) */
  var loadReq = 0;
  function load(quiet) {
    var req = ++loadReq;
    if (!quiet) { loadState = 'loading'; render(); }
    return api('GET', '/api/members').then(function (r) {
      if (req !== loadReq) return;
      if (!r.ok || !r.data.members) throw new Error(String(r.status));
      var local = members.filter(function (m) { return m.local; });   /* CSV 예시 행은 유지 */
      members = local.concat(r.data.members.map(fromApi));
      loadState = 'ready';
      render();
    }).catch(function () {
      if (req !== loadReq) return;
      if (quiet && loadState === 'ready') { Kona.toast('목록을 새로 불러오지 못했어요', 'info'); return; }
      loadState = 'error';
      render();
    });
  }

  var STATUS = {
    invited: { label: '초대됨', badge: 'badge-status--invited' },
    active: { label: '사용 중', badge: 'badge-status--active' },
    suspended: { label: '정지', badge: 'badge-status--suspended' },
    revoked: { label: '회수됨', badge: 'badge-status--revoked' }
  };
  var FILTERS = [['all', '전체'], ['invited', '초대됨'], ['active', '사용 중'], ['suspended', '정지'], ['revoked', '회수됨']];

  var view = {
    status: 'all',
    dept: M.DEPTS.indexOf(params.get('dept')) > -1 ? params.get('dept') : '',
    q: '',
    page: 1
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = {
    total: $('[data-total]'),
    listOnly: document.querySelectorAll('[data-list-only]'),
    filters: $('[data-filters]'),
    deptClear: $('[data-dept-clear]'),
    search: $('[data-search]'),
    searchClear: $('[data-search-clear]'),
    rows: $('[data-rows]'),
    cards: $('[data-cards]'),
    table: $('.member-table__table'),
    none: $('[data-none]'),
    footer: $('[data-footer]'),
    range: $('[data-range]'),
    pager: $('[data-pager]'),
    empty: $('[data-empty]'),
    live: $('[data-live]')
  };

  /* ---------- 도우미 ---------- */
  /* 받침 유무로 조사 고르기: josa('강도윤', '을', '를') → 을. 한글이 아니면 앞의 것 */
  function josa(word, withBatchim, without) {
    var c = String(word).charCodeAt(String(word).length - 1);
    if (c < 0xAC00 || c > 0xD7A3) return withBatchim;
    return (c - 0xAC00) % 28 ? withBatchim : without;
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  /* 회수된 직원 포함 — 이메일은 회사 전체에서 하나 (서버도 409) */
  function findByEmail(email) {
    email = email.trim().toLowerCase();
    return members.filter(function (m) { return m.email.toLowerCase() === email; })[0];
  }
  function byId(id) { return members.filter(function (m) { return m.id === id; })[0]; }
  function newLast4() {
    var used = members.map(function (m) { return m.last4; });
    var n;
    do { n = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (used.indexOf(n) > -1);
    return n;
  }
  /* CSV 예시 행만 — 저장하지 않으니 ⋯ 메뉴 없음 */
  function addLocalMember(name, email, dept) {
    var m = { id: 'csv-' + (++csvId), local: true, name: name, email: email, dept: dept || '', last4: newLast4(), status: 'invited', invited: M.today };
    members.unshift(m);   /* 초대일 최신순 → 맨 위 */
    return m;
  }
  function subLine(m) { return (m.dept || '부서 없음') + ' · •••• ' + m.last4; }

  /* ---------- 걸러내기 ---------- */
  function inDept() {
    return members.filter(function (m) { return !view.dept || m.dept === view.dept; });
  }
  function filtered() {
    var q = view.q.trim().toLowerCase();
    return inDept().filter(function (m) {
      if (view.status !== 'all' && m.status !== view.status) return false;
      if (q && m.name.toLowerCase().indexOf(q) < 0 && m.email.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ---------- 그리기 ---------- */
  function render() {
    if (loadState !== 'ready') { renderLoad(); return; }
    var empty = members.length === 0;
    el.total.textContent = '총 ' + members.length + '명';
    el.listOnly.forEach(function (n) { n.hidden = empty; });
    el.empty.hidden = !empty;
    if (empty) { renderEmpty(); return; }
    el.empty.innerHTML = '';

    renderFilters();
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (view.page > pages) view.page = pages;
    var start = (view.page - 1) * PER_PAGE;
    var pageItems = list.slice(start, start + PER_PAGE);

    el.rows.innerHTML = pageItems.map(rowHTML).join('');
    el.cards.innerHTML = pageItems.map(cardHTML).join('');

    var none = list.length === 0;
    el.table.hidden = none;
    el.cards.hidden = none;
    el.footer.hidden = none;
    el.none.hidden = !none;
    if (none) renderNone();

    el.range.textContent = none ? '' : (start + 1) + '–' + (start + pageItems.length) + ' / 총 ' + list.length + '명';
    renderPager(pages);
  }

  function renderFilters() {
    var base = inDept();
    var count = function (s) { return s === 'all' ? base.length : base.filter(function (m) { return m.status === s; }).length; };
    el.filters.innerHTML = FILTERS.map(function (f) {
      var on = view.status === f[0];
      return '<button class="filter-chip" type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-status="' + f[0] + '">' +
        f[1] + ' <span class="filter-chip__count">' + count(f[0]) + '</span></button>';
    }).join('');

    el.deptClear.hidden = !view.dept;
    if (view.dept) {
      el.deptClear.innerHTML = '부서: ' + esc(view.dept) + '<img src="assets/icon-close-secondary.svg" alt="" width="16" height="16">';
      el.deptClear.setAttribute('aria-label', '부서 필터 ' + view.dept + ' 해제');
    }
    el.searchClear.hidden = !view.q;
  }

  function badge(m) {
    return '<span class="badge-status ' + STATUS[m.status].badge + '">' + STATUS[m.status].label + '</span>';
  }
  function moreBtn(m, cls) {
    /* 회수됨 · CSV 예시 행: 할 수 있는 동작 없음 — 자리만 유지 */
    if (m.status === 'revoked' || m.local) return cls ? '<span class="' + cls + '" aria-hidden="true"></span>' : '';
    return '<button class="icon-btn' + (cls ? ' ' + cls : '') + '" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="row-menu" ' +
      (busyId === m.id ? 'disabled ' : '') +
      'aria-label="' + esc(m.name) + ' 관리 메뉴" data-menu-open="' + m.id + '">' +
      '<img src="assets/icon-ellipsis-outlined.svg" alt="" width="20" height="20"></button>';
  }
  function rowHTML(m) {
    return '<tr class="member-row' + (m.status === 'revoked' ? ' is-revoked' : '') + '" data-id="' + m.id + '">' +
      '<th scope="row" class="member-row__name" tabindex="-1">' + esc(m.name) + '</th>' +
      '<td title="' + esc(m.email) + '">' + esc(m.email) + '</td>' +
      '<td>' + (m.dept ? esc(m.dept) : '-') + '</td>' +
      '<td class="member-row__card member-row__num"><span aria-hidden="true">•••• </span><span class="visually-hidden">끝자리 </span>' + m.last4 + '</td>' +
      '<td>' + badge(m) + '</td>' +
      '<td class="member-row__num col-date">' + m.invited + '</td>' +
      '<td class="member-row__more">' + moreBtn(m) + '</td></tr>';
  }
  function cardHTML(m) {
    return '<li class="member-card' + (m.status === 'revoked' ? ' is-revoked' : '') + '" data-id="' + m.id + '">' +
      '<div class="member-card__top"><p class="member-card__name" tabindex="-1">' + esc(m.name) + '</p>' + badge(m) + moreBtn(m, 'member-card__more') + '</div>' +
      '<p class="member-card__line">' + esc(m.email) + '</p>' +
      '<p class="member-card__line">' + (m.dept ? esc(m.dept) : '-') + ' · <span aria-hidden="true">•••• </span><span class="visually-hidden">카드 끝자리 </span>' + m.last4 +
      ' · <span class="visually-hidden">초대일 </span>' + m.invited + '</p></li>';
  }

  function renderNone() {
    if (view.q) {
      el.none.innerHTML = '<p class="member-table__none-title">\'' + esc(view.q) + '\'' + josa(view.q, '과', '와') + ' 일치하는 임직원이 없어요</p>' +
        '<button class="btn btn--secondary" type="button" data-reset="search">검색 초기화</button>';
    } else {
      el.none.innerHTML = '<p class="member-table__none-title">조건에 맞는 임직원이 없어요</p>' +
        '<button class="btn btn--secondary" type="button" data-reset="filter">필터 초기화</button>';
    }
  }

  function renderPager(pages) {
    var p = view.page;
    var arrow = function (dir, to, disabled) {
      var name = dir === 'prev' ? '이전' : '다음';
      return '<button class="pager__btn" type="button" aria-label="' + name + ' 페이지"' + (disabled ? ' disabled' : ' data-page="' + to + '"') + '>' +
        '<img src="assets/icon-page-' + dir + (disabled ? '-disabled' : '') + '.svg" alt="" width="20" height="20"></button>';
    };
    var html = arrow('prev', p - 1, p === 1);
    for (var i = 1; i <= pages; i++) {
      html += '<button class="pager__btn pager__btn--num" type="button" data-page="' + i + '"' +
        (i === p ? ' aria-current="page"' : '') + ' aria-label="' + i + '페이지">' + i + '</button>';
    }
    html += '<span class="pager__status" aria-hidden="true">' + p + ' / ' + pages + '</span>';
    html += arrow('next', p + 1, p === pages);
    el.pager.innerHTML = html;
  }

  /* 불러오는 중: 기존 skeleton / 실패: alert-box + [다시 시도] (03 예약 시간 불러오기 실패와 같은 구성) */
  function renderLoad() {
    el.total.textContent = '';
    el.listOnly.forEach(function (n) { n.hidden = true; });
    el.empty.hidden = false;
    if (loadState === 'loading') {
      el.empty.innerHTML = '<div class="skeleton skeleton--history" aria-hidden="true"></div>';
      announce('임직원 목록을 불러오는 중이에요');
      return;
    }
    /* 목록 자리(member-table 패널) 안에 — 결과 없음 블록과 같은 배치 */
    el.empty.innerHTML =
      '<div class="member-table"><div class="member-table__none">' +
        '<div class="alert-box" role="alert"><img class="alert-box__icon" src="assets/icon-alert-danger.svg" alt="" width="20" height="20">' +
          '<div class="alert-box__text"><p class="alert-box__title">임직원 목록을 불러오지 못했어요</p><p>잠시 후 다시 시도해주세요</p></div></div>' +
        '<button class="btn btn--secondary" type="button" data-load-retry>다시 시도</button>' +
      '</div></div>';
  }

  function renderEmpty() {
    if (el.empty.querySelector('.empty-state')) return;
    var steps = [
      ['임직원 초대', '이름과 이메일만 입력하면 돼요'],
      ['카드 즉시 발급', '초대와 동시에 법인카드가 발급돼요'],
      ['임직원 첫 로그인', '전달받은 임시 비밀번호로 로그인해요']
    ];
    el.empty.innerHTML =
      '<section class="empty-state empty-state--panel" aria-labelledby="empty-title">' +
        '<div class="empty-state__text"><h2 id="empty-title" class="empty-state__title">첫 임직원을 초대해보세요</h2>' +
        '<p class="empty-state__desc">초대하면 임시 비밀번호가 바로 만들어지고, 법인카드가 발급돼요.</p></div>' +
        '<ol class="empty-steps">' + steps.map(function (s, i) {
          return '<li class="empty-step"><span class="empty-step__num" aria-hidden="true">' + (i + 1) + '</span>' +
            '<p class="empty-step__title">' + s[0] + '</p><p class="empty-step__desc">' + s[1] + '</p></li>';
        }).join('') + '</ol>' +
        '<div class="empty-state__actions">' +
          '<button class="btn btn--secondary" type="button" data-open="csv">CSV로 한 번에 등록</button>' +
          '<button class="btn btn--primary" type="button" data-open="invite">임직원 초대하기</button>' +
        '</div>' +
      '</section>';
  }

  function announce(text) {
    el.live.textContent = '';
    setTimeout(function () { el.live.textContent = text; }, 50);
  }
  function announceCount() {
    var n = filtered().length;
    announce(n ? n + '명이 있어요' : '조건에 맞는 임직원이 없어요');
  }

  /* 필터를 모두 풀고 1페이지 (새로 초대한 사람이 맨 위에 바로 보이게) */
  function resetView() {
    view.status = 'all';
    view.q = '';
    el.search.value = '';
    view.page = 1;
    setDept('');
  }
  function setDept(dept) {
    view.dept = dept;
    var url = new URL(window.location.href);
    if (dept) url.searchParams.set('dept', dept); else url.searchParams.delete('dept');
    history.replaceState(null, '', url);
  }

  /* 모달이 닫힌 뒤 포커스 — 연 버튼이 다시 그려져 사라졌으면 그 사람의 ⋯ → 이름 → 선택된 칩 순 */
  function focusMember(id) {
    var mobile = window.matchMedia('(max-width: 767px)').matches;
    var root = mobile ? el.cards : el.rows;
    var target = root.querySelector('[data-menu-open="' + id + '"]') ||
      root.querySelector('[data-id="' + id + '"] [tabindex="-1"]') ||
      el.filters.querySelector('[aria-checked="true"]');
    if (target) target.focus({ preventScroll: false });
  }
  function focusFallback(sel) {
    var a = document.activeElement;
    if (a && a !== document.body && a.offsetParent) return;   /* 닫힌 모달 안 버튼은 offsetParent가 없음 */
    var target = document.querySelector(sel);
    if (target) target.focus();
  }

  /* ---------- 필터 · 검색 · 페이지 ---------- */
  el.filters.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-status]');
    if (!chip || chip.getAttribute('aria-checked') === 'true') return;
    view.status = chip.getAttribute('data-status');
    view.page = 1;
    render();
    el.filters.querySelector('[data-status="' + view.status + '"]').focus();
    announceCount();
  });

  el.deptClear.addEventListener('click', function () {
    setDept('');
    view.page = 1;
    render();
    el.filters.querySelector('[aria-checked="true"]').focus();
    announceCount();
  });

  var searchTimer;
  el.search.addEventListener('input', function () {
    view.q = el.search.value;
    view.page = 1;
    el.searchClear.hidden = !view.q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { render(); announceCount(); }, 150);
  });
  el.searchClear.addEventListener('click', function () { clearSearch(); });
  function clearSearch() {
    el.search.value = '';
    view.q = '';
    view.page = 1;
    render();
    el.search.focus();
    announceCount();
  }

  el.none.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-reset]');
    if (!btn) return;
    if (btn.getAttribute('data-reset') === 'search') { clearSearch(); return; }
    view.status = 'all';
    view.page = 1;
    setDept('');
    render();
    el.filters.querySelector('[aria-checked="true"]').focus();
    announceCount();
  });

  el.pager.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-page]');
    if (!btn) return;
    var label = btn.getAttribute('aria-label');
    view.page = +btn.getAttribute('data-page');
    render();
    /* 누른 버튼 자리에 포커스 유지. 화살표가 Disabled가 되면 현재 페이지 번호(Mobile은 반대쪽 화살표)로 */
    var again = el.pager.querySelector('[aria-label="' + label + '"]');
    if (!again || again.disabled) {
      again = window.matchMedia('(max-width: 767px)').matches
        ? el.pager.querySelector('.pager__btn:not(:disabled):not(.pager__btn--num)')
        : el.pager.querySelector('[aria-current="page"]');
    }
    if (again) again.focus();
    document.querySelector('.member-table').scrollIntoView({ block: 'nearest' });
    announce(view.page + '페이지');
  });

  /* ---------- 행 ⋯ 메뉴 ----------
     위치: ⋯ 버튼 아래 4, 오른쪽 끝 맞춤(아래 공간이 모자라면 위로) / Mobile: 하단 시트
     바깥 클릭 · ESC · 선택으로 닫힘, ↑↓ · Home · End 이동 */
  var menu = $('[data-menu]');
  var menuOverlay = $('[data-menu-overlay]');
  var menuFor = null;   /* { member, btn } */

  var MENU_ITEMS = {
    reissue: { icon: 'icon-lock.svg', label: '임시 비밀번호 다시 발급' },
    suspend: { icon: 'icon-pause.svg', label: '카드 정지' },
    unsuspend: { icon: 'icon-play.svg', label: '정지 해제' },
    revoke: { icon: 'icon-delete.svg', label: '카드 회수 (퇴사 처리)', danger: true }
  };
  /* 상태 전이표 (backend/app/member_rules.py)와 같음 — 회수는 회수됨 말고 모두 가능 */
  var MENU_BY_STATUS = { invited: ['reissue'], active: ['suspend'], suspended: ['unsuspend'] };

  function openMenu(btn) {
    var m = byId(btn.getAttribute('data-menu-open'));
    if (!m || btn.disabled) return;
    if (menuFor && menuFor.btn === btn) { closeMenu(true); return; }
    if (menuFor) closeMenu(false);

    var item = function (key) {
      var it = MENU_ITEMS[key];
      return '<button class="row-menu__item' + (it.danger ? ' row-menu__item--danger' : '') + '" type="button" role="menuitem" tabindex="-1" data-action="' + key + '">' +
        '<img src="assets/' + it.icon + '" alt="" width="20" height="20">' + it.label + '</button>';
    };
    menu.innerHTML = '<p class="row-menu__title" aria-hidden="true">' + esc(m.name) + '</p>' +
      MENU_BY_STATUS[m.status].map(item).join('') +
      '<div class="row-menu__divider" role="separator"></div>' + item('revoke');
    menu.setAttribute('aria-label', m.name + ' 관리 메뉴');

    menuFor = { member: m, btn: btn };
    btn.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    var mobile = window.matchMedia('(max-width: 767px)').matches;
    if (mobile) {
      menuOverlay.hidden = false;
      document.body.classList.add('is-locked');
    } else {
      placeMenu();
    }
    menu.querySelector('[role="menuitem"]').focus();
  }

  function placeMenu() {
    var r = menuFor.btn.getBoundingClientRect();
    var h = menu.offsetHeight;
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - 4 - h > 8) top = r.top - 4 - h;   /* 아래 공간 부족 → 위로 */
    menu.style.top = top + 'px';
    menu.style.left = (r.right - menu.offsetWidth) + 'px';
  }

  function closeMenu(returnFocus) {
    if (!menuFor) return;
    var btn = menuFor.btn;
    btn.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    menuOverlay.hidden = true;
    document.body.classList.remove('is-locked');
    menuFor = null;
    if (returnFocus && document.contains(btn)) btn.focus();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-menu-open]');
    if (btn) { openMenu(btn); return; }
    if (menuFor && !menu.contains(e.target)) closeMenu(false);
  });

  /* ⋯ 버튼에서 ↓ · ↑로도 열기 */
  document.addEventListener('keydown', function (e) {
    var btn = e.target.closest && e.target.closest('[data-menu-open]');
    if (btn && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      if (!menuFor) openMenu(btn);
      if (e.key === 'ArrowUp') { var all = menu.querySelectorAll('[role="menuitem"]'); all[all.length - 1].focus(); }
    }
  });

  menu.addEventListener('keydown', function (e) {
    var items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
    var i = items.indexOf(document.activeElement);
    var next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); return; }
    if (next) { e.preventDefault(); next.focus(); }
  });

  menu.addEventListener('click', function (e) {
    var it = e.target.closest('[data-action]');
    if (!it || !menuFor) return;
    var m = menuFor.member;
    var btn = menuFor.btn;
    var action = it.getAttribute('data-action');
    closeMenu(false);

    if (action === 'reissue') {
      reissue(m, btn);
    } else if (action === 'unsuspend') {
      openTargetModal('modal-resume', m, btn);
    } else if (action === 'suspend') {
      openTargetModal('modal-suspend', m, btn);
    } else if (action === 'revoke') {
      openTargetModal('modal-revoke', m, btn);
    }
  });

  /* 메뉴가 열린 채 스크롤 · 크기 변경 → 닫기 (위치가 버튼에서 떨어지지 않게) */
  window.addEventListener('resize', function () { if (menuFor) closeMenu(false); });
  window.addEventListener('scroll', function () {
    if (menuFor && !window.matchMedia('(max-width: 767px)').matches) closeMenu(false);
  }, true);
  menuOverlay.addEventListener('click', function () { closeMenu(true); });

  /* ---------- 정지 · 정지 해제 · 회수 확인 모달 → API ---------- */
  var target = null;   /* 확인 모달이 다루는 임직원 */

  var TARGET_TITLE = {
    'modal-suspend': function (n) { return n + '님의 카드를 정지할까요?'; },
    'modal-resume': function (n) { return n + '님의 카드 정지를 해제할까요?'; },
    'modal-revoke': function (n) { return n + '님의 카드를 회수할까요?'; }
  };

  function openTargetModal(id, m, opener) {
    target = m;
    var modal = document.getElementById(id);
    $('[data-target-title]', modal).textContent = TARGET_TITLE[id](m.name);
    $('[data-target-sub]', modal).textContent = subLine(m);
    if (id === 'modal-revoke') {
      $('[data-revoke-label]', modal).textContent = '확인을 위해 이름 ' + m.name + josa(m.name, '을', '를') + ' 입력해주세요';
      revokeInput.value = '';
      revokeSubmit.disabled = true;
      modal.removeAttribute('data-dirty');
    }
    Kona.openModal(id, opener);
  }

  /* 요청 중: 확인 버튼 비활성 + "…중"(로그인·예약 버튼과 같은 방식), 해당 행 ⋯ 비활성 */
  function setRowBusy(m, btn, label) {
    busyId = m ? m.id : null;
    document.querySelectorAll('[data-menu-open]').forEach(function (b) {
      b.disabled = busyId !== null && b.getAttribute('data-menu-open') === busyId;
    });
    if (btn) {
      if (!btn.hasAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
      btn.disabled = !!label;
      btn.textContent = label || btn.getAttribute('data-label');
    }
  }

  /* 상태 변경 공통 — 성공: 토스트 + 목록 갱신 / 409: 안내 후 목록 새로고침 / 그 밖: 창은 열어 둔 채 안내 */
  function changeStatus(action, btn, busyLabel, doneMessage) {
    var m = target;
    if (!m || busyId) return;
    var modalEl = Kona.currentModal();
    setRowBusy(m, btn, busyLabel);
    if (modalEl) modalEl.setAttribute('data-locked', '');   /* 요청 중에는 닫히지 않게 */
    api('POST', '/api/members/' + encodeURIComponent(m.id) + '/' + action).then(function (r) {
      if (modalEl) modalEl.removeAttribute('data-locked');
      setRowBusy(null, btn, '');
      if (r.ok || r.status === 409 || r.status === 404) {
        Kona.closeModal('done');
        target = null;
        Kona.toast(r.ok ? doneMessage : detail(r), r.ok ? 'success' : 'info');
        load(true).then(function () { focusMember(m.id); });
        return;
      }
      if (r.status !== 401) Kona.toast(MSG_FAIL, 'info');
    }).catch(function () {
      if (modalEl) modalEl.removeAttribute('data-locked');
      setRowBusy(null, btn, '');
      Kona.toast(MSG_FAIL, 'info');
    });
  }

  var suspendSubmit = $('[data-suspend-submit]');
  suspendSubmit.addEventListener('click', function () {
    if (target) changeStatus('suspend', suspendSubmit, '정지 중…', target.name + '님의 카드를 정지했어요');
  });
  var resumeSubmit = $('[data-resume-submit]');
  resumeSubmit.addEventListener('click', function () {
    if (target) changeStatus('resume', resumeSubmit, '해제 중…', target.name + '님의 카드 정지를 해제했어요');
  });

  /* 회수: 이름이 정확히 같을 때만 [카드 회수하기] 활성 */
  var revokeModal = document.getElementById('modal-revoke');
  var revokeInput = document.getElementById('revoke-name');
  var revokeSubmit = $('[data-revoke-submit]');
  revokeInput.addEventListener('input', function () {
    revokeSubmit.disabled = !target || revokeInput.value.trim() !== target.name;
    revokeModal.toggleAttribute('data-dirty', !!revokeInput.value);
  });
  document.getElementById('revoke-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!target || revokeInput.value.trim() !== target.name) return;
    changeStatus('revoke', revokeSubmit, '회수 중…', target.name + '님의 카드를 회수했어요');
  });

  /* ---------- 임시 비밀번호 재발급 → 완료 화면 ---------- */
  function reissue(m, btn) {
    if (busyId) return;
    setRowBusy(m, null);
    announce(m.name + '님의 임시 비밀번호를 발급하는 중이에요');
    api('POST', '/api/members/' + encodeURIComponent(m.id) + '/temp-password').then(function (r) {
      setRowBusy(null, null);
      if (r.ok && r.data.temp_password) {
        Kona.openModal('modal-invite', btn);
        showDone(fromApi(r.data.member), r.data.temp_password, 'reissue');
        return;
      }
      if (r.status === 401) return;
      Kona.toast(r.status === 409 || r.status === 404 ? detail(r) : MSG_FAIL, 'info');
      if (r.status === 409 || r.status === 404) load(true).then(function () { focusMember(m.id); });
      else if (document.contains(btn)) btn.focus();
    }).catch(function () {
      setRowBusy(null, null);
      Kona.toast(MSG_FAIL, 'info');
      if (document.contains(btn)) btn.focus();
    });
  }

  /* ---------- 임직원 초대 모달 ---------- */
  var inviteModal = document.getElementById('modal-invite');
  var inviteForm = document.getElementById('invite-form');
  var inviteSubmit = $('[data-invite-submit]');
  var f = {
    name: document.getElementById('invite-name'),
    email: document.getElementById('invite-email'),
    dept: document.getElementById('invite-dept')
  };
  document.getElementById('invite-dept-list').innerHTML = M.DEPTS.map(function (d) { return '<option value="' + d + '">'; }).join('');

  function setError(key, msg) {
    var field = $('[data-field="' + key + '"]', inviteForm);
    field.classList.toggle('is-error', !!msg);
    f[key].setAttribute('aria-invalid', msg ? 'true' : 'false');
    $('.field__error', field).textContent = msg || '';
  }
  function checkName() {
    setError('name', f.name.value.trim() ? '' : '이름을 입력해주세요.');
  }
  /* 이메일 중복 문구는 서버(409)와 같음 — 회수된 직원이면 다른 문구 */
  var MSG_DUP = '이미 등록된 이메일이에요.';
  var MSG_DUP_REVOKED = '카드가 회수된 직원의 이메일이에요. 다른 이메일로 초대해주세요.';
  function checkEmail() {
    var v = f.email.value.trim();
    var dup = v && findByEmail(v);
    setError('email',
      !v ? '이메일을 입력해주세요.' :
      !EMAIL_RE.test(v) ? '이메일 형식이 아니에요. @ 뒤에 도메인 전체를 입력해주세요. (예: company.co.kr)' :
      dup ? (dup.status === 'revoked' ? MSG_DUP_REVOKED : MSG_DUP) : '');
  }
  function checkDept() {
    var v = f.dept.value.trim();
    setError('dept', !v ? '부서를 입력해주세요.' : M.DEPTS.indexOf(v) < 0 ? '목록에서 부서를 골라주세요.' : '');
  }
  var CHECK = { name: checkName, email: checkEmail, dept: checkDept };

  /* 필수 미입력 · 오류가 보이는 동안 · 요청 중 Disabled */
  var inviting = false;
  var INVITE_LABEL = inviteSubmit.textContent;
  function updateInviteSubmit() {
    var hasError = !!inviteForm.querySelector('.field.is-error');
    inviteSubmit.disabled = inviting || !f.name.value.trim() || !f.email.value.trim() || !f.dept.value.trim() || hasError;
    inviteModal.toggleAttribute('data-dirty', !!(f.name.value || f.email.value || f.dept.value));
  }
  /* 로그인 버튼과 같은 방식: 비활성 + "초대 중…", 입력칸도 잠금. 요청 중에는 창이 닫히지 않음 */
  function setInviting(busy) {
    inviting = busy;
    inviteSubmit.textContent = busy ? '초대 중…' : INVITE_LABEL;
    ['name', 'email', 'dept'].forEach(function (k) { f[k].disabled = busy; });
    inviteModal.toggleAttribute('data-locked', busy);
    updateInviteSubmit();
  }
  var inviteAlert = $('[data-invite-alert]');

  /* 형식 · 중복은 칸을 벗어날 때 검사, 오류가 난 칸은 고치는 동안 다시 검사 */
  ['name', 'email', 'dept'].forEach(function (key) {
    f[key].addEventListener('blur', function () { if (f[key].value) CHECK[key](); updateInviteSubmit(); });
    f[key].addEventListener('input', function () {
      var field = $('[data-field="' + key + '"]', inviteForm);
      if (field.classList.contains('is-error')) CHECK[key]();
      inviteAlert.hidden = true;
      updateInviteSubmit();
    });
  });
  /* datalist에서 고르면 바로 확인 (blur 전에도 버튼이 켜지게) */
  f.dept.addEventListener('change', function () { checkDept(); updateInviteSubmit(); });

  inviteModal.addEventListener('modal:open', function () {
    showView('form');
    inviteForm.reset();
    setError('name', '');
    setError('email', '');
    setError('dept', '');
    inviteAlert.hidden = true;
    setInviting(false);
  });

  /* 서버 오류를 칸에 — 409는 이메일, 422는 해당 칸 */
  function showInviteErrors(errors) {
    ['name', 'email', 'dept'].forEach(function (k) { if (errors[k]) setError(k, errors[k]); });
    updateInviteSubmit();
    var first = inviteForm.querySelector('.field.is-error .field__input');
    if (first) first.focus();
  }

  inviteForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (inviting) return;
    checkName();
    checkEmail();
    checkDept();
    updateInviteSubmit();
    var firstError = inviteForm.querySelector('.field.is-error .field__input');
    if (firstError) { firstError.focus(); return; }

    inviteAlert.hidden = true;
    setInviting(true);
    api('POST', '/api/members', { name: f.name.value.trim(), email: f.email.value.trim(), dept: f.dept.value.trim() }).then(function (r) {
      setInviting(false);
      if (r.status === 201 && r.data.temp_password) {
        var m = fromApi(r.data.member);
        members.unshift(m);   /* 초대일 최신순 → 맨 위 (뒤에서 서버 목록으로 다시 맞춤) */
        resetView();
        render();
        showDone(m, r.data.temp_password, 'invite');
        load(true);
        return;
      }
      if (r.status === 409) { showInviteErrors({ email: detail(r) }); return; }
      if (r.status === 422 && r.data.errors) { showInviteErrors(r.data.errors); return; }
      if (r.status !== 401) inviteAlert.hidden = false;   /* 일시적 오류 — 입력값 유지 */
    }).catch(function () {
      setInviting(false);
      inviteAlert.hidden = false;
    });
  });

  /* ---------- 완료 화면 (초대 · 재발급) ----------
     임시 비밀번호는 이 화면에만 — [확인]으로 닫으면 화면에서 지우고 다시 보여주지 않음 (서버도 해시만 저장)
     바깥 클릭 · ESC로 안 닫힘(data-locked). 이메일 · 비밀번호는 전체 표시, 각각 드래그로 선택 가능
     [로그인 정보 복사]는 이메일 + 임시 비밀번호를 정해진 형식(loginText)으로 한 번에 */
  var formView = $('[data-invite-view="form"]', inviteModal);
  var doneView = $('[data-invite-view="done"]', inviteModal);
  var invitePanel = $('.modal__panel', inviteModal);
  var tempPw = $('[data-temp-pw]', doneView);
  var loginEmail = $('[data-login-email]', doneView);
  var loginInfo = $('[data-login-info]', doneView);
  var copyBtn = $('[data-copy]', doneView);
  var copyFail = $('[data-copy-fail]', doneView);
  var copyLive = $('[data-copy-live]', doneView);
  var COPY_LABEL = copyBtn.textContent;
  var copyTimer;
  var doneFor = null;   /* { member, kind } */

  function showView(name) {
    var done = name === 'done';
    formView.hidden = done;
    doneView.hidden = !done;
    invitePanel.setAttribute('aria-labelledby', done ? 'invite-done-title' : 'invite-title');
    invitePanel.setAttribute('aria-describedby', done ? 'invite-done-desc invite-done-alert' : 'invite-desc');
    inviteModal.toggleAttribute('data-locked', done);
    if (!done) {
      tempPw.textContent = '';
      loginEmail.textContent = '';
      doneFor = null;
    }
  }

  function showDone(m, password, kind) {
    doneFor = { member: m, kind: kind };
    $('[data-done-title]', doneView).textContent = kind === 'invite'
      ? m.name + '님을 초대했어요'
      : m.name + '님의 임시 비밀번호를 다시 발급했어요';
    $('[data-done-desc]', doneView).textContent = kind === 'invite'
      ? subLine(m)
      : '이전 임시 비밀번호는 더 이상 쓸 수 없어요.';
    loginEmail.textContent = m.email;
    tempPw.textContent = password;
    clearTimeout(copyTimer);
    copyBtn.textContent = COPY_LABEL;
    copyFail.hidden = true;
    copyLive.textContent = '';
    showView('done');
    inviteModal.removeAttribute('data-dirty');
    requestAnimationFrame(function () { $('[data-done-title]', doneView).focus(); });
  }

  function loginText() {
    return '[코나비즈] 로그인 정보\n이메일: ' + loginEmail.textContent + '\n임시 비밀번호: ' + tempPw.textContent;
  }
  /* 로그인 정보(이메일 · 비밀번호)를 선택해 둠 — 복사가 막혔을 때 바로 Ctrl+C 할 수 있게 */
  function selectLoginInfo() {
    var range = document.createRange();
    range.selectNodeContents(loginInfo);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function copyFailed() {
    copyFail.hidden = false;
    selectLoginInfo();
  }
  copyBtn.addEventListener('click', function () {
    if (!tempPw.textContent) return;
    var text = loginText();
    copyFail.hidden = true;
    /* clipboard API → 안 되면 textarea 대체 복사 (common.js) — 둘 다 실패할 때만 직접 선택 안내 */
    Kona.copyText(text).then(function () {
      copyBtn.textContent = '복사했어요';
      copyLive.textContent = '';
      setTimeout(function () { copyLive.textContent = '로그인 정보를 복사했어요'; }, 50);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { copyBtn.textContent = COPY_LABEL; }, 2000);
    }, copyFailed);
  });

  $('[data-done-close]', doneView).addEventListener('click', function () {
    var info = doneFor;
    showView('form');   /* 비밀번호를 화면에서 지움 */
    inviteModal.removeAttribute('data-locked');
    Kona.closeModal('done');
    if (window.getSelection) window.getSelection().removeAllRanges();
    if (!info) return;
    if (info.kind === 'invite') {
      focusMember(info.member.id);
      focusFallback('.page-header__actions [data-open="invite"]');
      Kona.toast(info.member.name + '님을 초대했어요');
    } else {
      focusMember(info.member.id);
    }
  });

  /* ---------- CSV로 한 번에 등록 ----------
     업로드 단계는 디자인이 없어(기획서 14.1) 예시 파일 결과를 바로 보여줌. 행 검사는 열 때마다 다시 함 */
  var csvModal = document.getElementById('modal-csv');
  var csvBody = $('[data-csv-body]');
  var csvSubmit = $('[data-csv-submit]');
  var csvReupload = $('[data-csv-reupload]');
  var csvFileInput = $('[data-csv-file-input]');
  var csvFileName = M.csvSample.fileName;
  var csvValid = [];

  function checkRows() {
    var errors = [];
    csvValid = [];
    M.csvSample.rows.forEach(function (r) {
      var err = null;
      if (!r.name.trim()) err = ['이름', '이름이 비어 있어요. 이름을 입력해주세요.'];
      else if (!r.email.trim()) err = ['이메일', '이메일이 비어 있어요. 이메일을 입력해주세요.'];
      else if (!EMAIL_RE.test(r.email)) err = ['이메일', '이메일 형식이 아니에요. @ 뒤에 도메인 전체를 입력해주세요. (예: company.co.kr)'];
      else if (findByEmail(r.email)) err = ['이메일', '이미 등록된 임직원이에요. 이 행을 지우고 다시 올려주세요.'];
      if (err) errors.push({ row: r.row, field: err[0], value: err[0] === '이름' ? r.name : r.email, desc: err[1] });
      else csvValid.push(r);
    });
    return errors;
  }

  function renderCsv() {
    var errors = checkRows();
    var total = M.csvSample.rows.length;
    var n = csvValid.length;
    $('[data-csv-file]').textContent = csvFileName + ' · 총 ' + total + '행';

    var value = function (v) { return v ? esc(v) : '(비어 있음)'; };
    var alert = errors.length
      ? '<div class="alert-box" role="alert"><img class="alert-box__icon" src="assets/icon-alert-danger.svg" alt="" width="20" height="20">' +
        '<div class="alert-box__text"><p class="alert-box__title">' + (n ? total + '행 중 ' + errors.length + '행에' : total + '행 모두') + ' 문제가 있어요</p>' +
        '<p>' + (n ? '아래 행을 고쳐서 다시 올리거나, 문제없는 ' + n + '명만 먼저 초대할 수 있어요.' : '아래 행을 고쳐서 다시 올려주세요.') + '</p></div></div>'
      : '';
    csvBody.innerHTML = alert + (errors.length ?
      '<div class="csv-table__wrap"><div class="csv-table" tabindex="0" aria-label="문제가 있는 행"><table>' +
        '<thead><tr><th scope="col" class="col-row">행</th><th scope="col" class="col-field">항목</th>' +
        '<th scope="col" class="col-value">입력값</th><th scope="col">문제와 해결 방법</th></tr></thead><tbody>' +
        errors.map(function (er) {
          return '<tr><th scope="row" class="csv-table__row">' + er.row + '행</th><td class="csv-table__field">' + er.field + '</td>' +
            '<td class="csv-table__value' + (er.value ? '' : ' is-empty') + '">' + value(er.value) + '</td><td>' + er.desc + '</td></tr>';
        }).join('') +
      '</tbody></table></div></div>' +
      '<ul class="csv-cards" aria-label="문제가 있는 행">' + errors.map(function (er) {
        return '<li class="csv-card"><p class="csv-card__head">' + er.row + '행 · ' + er.field + '</p>' +
          '<p class="csv-card__value' + (er.value ? '' : ' is-empty') + '">' + value(er.value) + '</p>' +
          '<p class="csv-card__desc">' + er.desc + '</p></li>';
      }).join('') + '</ul>'
      : '<p class="modal-text">' + total + '행 모두 문제가 없어요.</p>');

    /* 초대할 수 있는 행이 없으면 [초대] 버튼을 숨기고 [파일 다시 올리기]가 주 버튼(Primary) */
    csvSubmit.textContent = errors.length ? n + '명만 초대하고 카드 발급하기' : n + '명 초대하고 카드 발급하기';
    csvSubmit.hidden = n === 0;
    csvReupload.classList.toggle('btn--primary', n === 0);
    csvReupload.classList.toggle('btn--secondary', n > 0);
  }

  csvModal.addEventListener('modal:open', function () {
    csvFileName = M.csvSample.fileName;
    csvSubmit.classList.remove('is-loading');
    csvReupload.classList.remove('is-loading');
    renderCsv();
  });

  /* [파일 다시 올리기] — 실제 파일 선택창. 어떤 파일을 골라도 예시 결과로 다시 검사 */
  csvReupload.addEventListener('click', function () { csvFileInput.click(); });
  csvFileInput.addEventListener('change', function () {
    var file = csvFileInput.files[0];
    csvFileInput.value = '';
    if (!file) return;
    csvReupload.classList.add('is-loading');
    setTimeout(function () {
      csvReupload.classList.remove('is-loading');
      csvFileName = file.name;
      renderCsv();
      csvReupload.focus();
      announce('파일을 다시 검사했어요');
    }, 600);
  });

  /* [CSV 양식 다시 받기] — 머리 줄만 있는 양식 (엑셀에서 한글이 깨지지 않게 BOM) */
  $('[data-csv-template]').addEventListener('click', function (e) {
    e.preventDefault();
    var blob = new Blob(['﻿이름,이메일,부서\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'konabiz_members_template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  csvSubmit.addEventListener('click', function () {
    if (!csvValid.length) return;
    csvSubmit.classList.add('is-loading');
    setTimeout(function () {
      csvSubmit.classList.remove('is-loading');
      var rows = csvValid.slice().reverse();   /* 파일 순서대로 위에서부터 보이게 */
      rows.forEach(function (r) { addLocalMember(r.name.trim(), r.email.trim(), r.dept.trim()); });   /* 예시 — 저장하지 않음 */
      resetView();
      render();
      Kona.closeModal('done');
      focusFallback('.page-header__actions [data-open="csv"]');
      Kona.toast(rows.length + '명을 초대했어요');
    }, 600);
  });

  /* ---------- 시작 ---------- */
  el.empty.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-load-retry]');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '불러오는 중…';
    load(false);
  });
  load(false);

  /* ?action=invite|csv — 대시보드 빈 상태 버튼에서 넘어왔을 때 모달 바로 열기 (새로고침해도 다시 안 열리게 주소에서 뺌) */
  var action = params.get('action');
  if (action === 'invite' || action === 'csv') {
    var url = new URL(window.location.href);
    url.searchParams.delete('action');
    history.replaceState(null, '', url);
    var opener = Array.prototype.filter.call(document.querySelectorAll('[data-open="' + action + '"]'), function (b) { return b.offsetParent; })[0];
    Kona.openModal('modal-' + action, opener);
  }
})();
