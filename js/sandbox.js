/* =========================================================
   코나비즈 — sandbox.js (07 Sandbox 상단 바)
   관리자 ⇄ 임직원 토글 · 주소에 탭 남기기(?view=employee, 기본 관리자) · 예약 정보
   본문은 iframe의 admin.html · employee.html(?sandbox=1) — 동작은 sandbox-mode.js
   ========================================================= */
(function () {
  'use strict';

  var LABEL = { admin: '관리자 대시보드 미리보기', employee: '임직원 마이페이지 미리보기' };
  var tablist = document.querySelector('[role="tablist"]');
  var tabs = tablist.querySelectorAll('[data-view-tab]');
  var live = document.querySelector('[data-sandbox-live]');

  /* ?view=employee만 임직원, 그 밖은 관리자 */
  function viewFromUrl() {
    return new URLSearchParams(window.location.search).get('view') === 'employee' ? 'employee' : 'admin';
  }

  function show(view, announce) {
    var tab = tablist.querySelector('[data-view-tab="' + view + '"]');
    Kona.selectItem(tablist, tab);
    tabs.forEach(function (t) {
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      var on = t === tab;
      panel.classList.toggle('is-active', on);
      panel.inert = !on;   /* 숨긴 화면으로 Tab 이동 막기 */
    });
    if (announce) live.textContent = LABEL[view] + '로 전환됨';
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var view = t.getAttribute('data-view-tab');
      if (t.getAttribute('aria-selected') === 'true') return;
      show(view, true);
      /* 새로고침·주소 공유 시 같은 탭이 열리게. 탭 전환은 방문 기록에 쌓지 않음 */
      var url = new URL(window.location.href);
      if (view === 'admin') url.searchParams.delete('view');
      else url.searchParams.set('view', view);
      history.replaceState(null, '', url);
    });
  });

  show(viewFromUrl(), false);

  /* ?chat=error|offline — 챗봇 상태 확인용 값을 두 iframe에 넘김 */
  var chat = new URLSearchParams(window.location.search).get('chat');
  if (chat) {
    document.querySelectorAll('.sandbox-frame').forEach(function (f) {
      var src = new URL(f.getAttribute('src'), window.location.href);
      src.searchParams.set('chat', chat);
      f.src = src.href;
    });
  }

  /* ---------- 예약 정보: 상담예약 완료 때 저장한 값. 없으면 숨김 ---------- */
  var r = null;
  try { r = JSON.parse(localStorage.getItem('kona.reservation')); } catch (e) { /* 무시 */ }
  var DAY = ['일', '월', '화', '수', '목', '금', '토'];
  var when = r && (r.preferredLabel || (function () {   /* 이전 버전 저장값: "2026-10-21" + "14:00" */
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.preferredDate || '');
    if (!p || !r.preferredTime) return '';
    var d = new Date(+p[1], p[2] - 1, +p[3]);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DAY[d.getDay()] + ') ' + r.preferredTime;
  })());
  if (when) {
    var booking = document.querySelector('[data-booking]');
    booking.textContent = when + (r.consultationType === 'inperson' ? ' 대면 방문 예정' : ' 전화 상담 예정');
    booking.hidden = false;
  }
})();
