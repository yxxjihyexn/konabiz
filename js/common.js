/* =========================================================
   코나비즈 — common.js (모든 화면 공통)
   모달 · 토스트 · 드로어 · 구간 선택 키보드 이동
   ========================================================= */
(function () {
  'use strict';

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), visible);
  }

  /* ---------- 모달 ----------
     열기: [닫기]·[취소]·ESC로 닫힘, 오버레이 클릭은 입력값이 없을 때만 닫힘
     열리면 [data-autofocus] → 첫 입력칸 → 첫 버튼 순으로 포커스, Tab은 모달 안에서만 순환
     닫히면 모달을 연 버튼으로 포커스 복귀, 배경 스크롤 잠금 */
  var current = null;   /* { el, opener } */

  function openModal(id, opener) {
    var el = document.getElementById(id);
    if (!el) return;

    /* 챗봇 패널은 자동으로 닫힘 (입력 중 문구 유지) — 포커스는 모달로 */
    if (window.KonaChat) window.KonaChat.close(true);

    /* 다른 모달이 열려 있으면 바꿔 끼움 (시뮬레이터 → 상담예약). 포커스 복귀 대상은 처음 연 버튼 유지 */
    if (current) {
      if (current.el === el) return;
      opener = current.opener;
      hide(current.el, 'switch');
    }

    current = { el: el, opener: opener || document.activeElement };
    el.hidden = false;
    document.body.classList.add('is-locked');
    el.dispatchEvent(new CustomEvent('modal:open', { detail: { opener: current.opener } }));
    requestAnimationFrame(function () {
      el.classList.add('is-open');
      focusFirst(el);
    });
  }

  function focusFirst(el) {
    var target = el.querySelector('[data-autofocus]:not([hidden])');
    if (!target || !visible(target)) {
      target = focusables(el).filter(function (n) { return /INPUT|SELECT|TEXTAREA/.test(n.tagName); })[0];
    }
    if (!target) target = focusables(el)[0];
    if (target) target.focus({ preventScroll: true });
  }

  function hide(el, reason) {
    el.classList.remove('is-open');
    el.hidden = true;
    el.dispatchEvent(new CustomEvent('modal:close', { detail: { reason: reason } }));
  }

  function closeModal(reason) {
    if (!current) return;
    var opener = current.opener;
    hide(current.el, reason || 'close');
    current = null;
    document.body.classList.remove('is-locked');
    if (opener && document.contains(opener) && visible(opener)) opener.focus({ preventScroll: true });
  }

  document.addEventListener('click', function (e) {
    var openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      var target = openBtn.getAttribute('data-open');
      var id = 'modal-' + target;
      if (!document.getElementById(id)) return;
      e.preventDefault();
      /* 드로어 안에서 누르면 드로어를 먼저 닫고, 포커스 복귀 대상은 메뉴 버튼 */
      var drawerEl = openBtn.closest('.drawer');
      var opener = openBtn;
      if (drawerEl && window.KonaDrawer) {
        window.KonaDrawer.close();
        opener = document.querySelector('[aria-controls="drawer"][aria-expanded]');
      }
      openModal(id, current ? null : opener);
      return;
    }

    if (!current) return;
    var closeBtn = e.target.closest('[data-modal-close]');
    if (closeBtn && current.el.contains(closeBtn)) {
      var isOverlay = closeBtn.classList.contains('modal__overlay');
      if (isOverlay && current.el.hasAttribute('data-dirty') ) return;   /* 입력값이 있으면 오버레이로 안 닫힘 */
      closeModal(isOverlay ? 'overlay' : 'button');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!current) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal('escape'); return; }
    if (e.key === 'Tab') {
      var list = focusables(current.el);
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !current.el.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  /* ---------- 토스트 ----------
     4초 후 사라짐, 마우스를 올리면 멈춤, 새 토스트가 오면 교체 */
  var toastEl, toastTimer, toastLeft;
  var TOAST_ICON = { success: 'assets/icon-check-circle-inverse.svg', info: 'assets/icon-info-inverse.svg' };

  function toast(message, type) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.innerHTML = '<img class="toast__icon" alt="" width="20" height="20"><span class="toast__text"></span>';
      document.body.appendChild(toastEl);
      toastEl.addEventListener('mouseenter', function () { clearTimeout(toastTimer); });
      toastEl.addEventListener('mouseleave', function () { startToastTimer(1500); });
    }
    toastEl.querySelector('.toast__icon').src = TOAST_ICON[type] || TOAST_ICON.success;
    toastEl.querySelector('.toast__text').textContent = message;
    toastEl.classList.add('is-show');
    startToastTimer(4000);
  }
  function startToastTimer(ms) {
    clearTimeout(toastTimer);
    toastLeft = ms;
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-show'); }, toastLeft);
  }

  /* ---------- 구간 선택 · 탭: 하나만 선택 + 방향키 이동 (roving tabindex) ---------- */
  function selectItem(group, item) {
    var role = item.getAttribute('role');
    var attr = role === 'tab' ? 'aria-selected' : role === 'radio' ? 'aria-checked' : 'aria-pressed';
    group.querySelectorAll('[role="' + role + '"]').forEach(function (n) {
      var on = n === item;
      n.setAttribute(attr, on ? 'true' : 'false');
      n.tabIndex = on ? 0 : -1;
    });
  }

  document.addEventListener('keydown', function (e) {
    var item = e.target.closest('[role="radio"], [role="tab"]');
    if (!item) return;
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
    var group = item.closest('[role="radiogroup"], [role="tablist"]');
    if (!group) return;
    var items = Array.prototype.filter.call(
      group.querySelectorAll('[role="' + item.getAttribute('role') + '"]'),
      function (n) { return !n.disabled && n.getAttribute('aria-disabled') !== 'true'; });
    var i = items.indexOf(item);
    var next = e.key === 'Home' ? items[0] : e.key === 'End' ? items[items.length - 1]
      : items[(i + keys[e.key] + items.length) % items.length];
    if (!next || next === item) return;
    e.preventDefault();
    next.focus();
    next.click();
  });

  window.Kona = {
    openModal: openModal,
    closeModal: closeModal,
    currentModal: function () { return current && current.el; },
    toast: toast,
    selectItem: selectItem
  };
})();

/* ---------- 드로어 (Tablet·Mobile) ----------
   ESC · 오버레이 · 닫기 버튼, 포커스 이동·복귀, 배경 스크롤 잠금 */
(function () {
  'use strict';
  var drawer = document.getElementById('drawer');
  var overlay = document.querySelector('.drawer-overlay');
  var opener = document.querySelector('[aria-controls="drawer"][aria-expanded]');   /* 랜딩 햄버거 · 앱 상단 바 메뉴 버튼 */
  if (!drawer || !overlay || !opener) return;

  var focusables = function () {
    return drawer.querySelectorAll('a[href], button:not([disabled])');
  };

  function open() {
    drawer.hidden = false;
    overlay.hidden = false;
    requestAnimationFrame(function () {
      drawer.classList.add('is-open');
      overlay.classList.add('is-open');
    });
    opener.setAttribute('aria-expanded', 'true');
    document.body.classList.add('is-locked');
    (drawer.querySelector('[data-drawer-first]') || focusables()[1]).focus(); /* 첫 메뉴에 포커스 */
  }

  function close() {
    if (drawer.hidden) return;
    drawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    opener.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('is-locked');
    setTimeout(function () { drawer.hidden = true; overlay.hidden = true; }, 200);
    opener.focus();
  }

  opener.addEventListener('click', open);
  document.querySelectorAll('[data-drawer-close]').forEach(function (el) {
    el.addEventListener('click', close);
  });
  drawer.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', close);
  });

  document.addEventListener('keydown', function (e) {
    if (drawer.hidden || !drawer.classList.contains('is-open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { /* 포커스 트랩 */
      var list = focusables();
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* 화면이 PC 폭(1024 이상)으로 커지면 열려 있던 드로어 닫기 */
  window.matchMedia('(min-width: 1024px)').addEventListener('change', function (mq) {
    if (mq.matches && !drawer.hidden) close();
  });

  window.KonaDrawer = { open: open, close: close };
})();
