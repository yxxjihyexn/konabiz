/* =========================================================
   코나비즈 — app.js (관리자 · 임직원 화면 공통)
   ?state= 읽기 · 사이드바 → 드로어 복사 · [다시 시도] · 공통 도우미
   ========================================================= */
window.KonaApp = (function () {
  'use strict';

  /* 1024 미만 드로어: 사이드바 내용을 그대로 복사 (마크업 한 곳에서 관리) */
  var sidebar = document.querySelector('.sidebar__inner');
  var drawerBody = document.querySelector('[data-drawer-body]');
  if (sidebar && drawerBody) {
    var copy = sidebar.cloneNode(true);
    var current = copy.querySelector('[aria-current="page"]');
    if (current) current.setAttribute('data-drawer-first', '');
    drawerBody.appendChild(copy);
  }

  /* ?state=empty 처럼 주소로 상태 화면 전환. 목록에 없는 값은 Default */
  function state(allowed) {
    var v = new URLSearchParams(window.location.search).get('state');
    return allowed.indexOf(v) > -1 ? v : 'default';
  }

  var won = function (n) { return n.toLocaleString('ko-KR') + '원'; };
  var num = function (n) { return n.toLocaleString('ko-KR'); };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

  /* 불러오기 실패 블록 — [다시 시도]를 누르면 onRetry 실행 */
  function loadError(onRetry) {
    var box = document.createElement('div');
    box.className = 'load-error';
    box.setAttribute('role', 'alert');
    box.innerHTML =
      '<img class="load-error__icon" src="assets/icon-alert.svg" alt="" width="24" height="24">' +
      '<div class="load-error__text"><p class="load-error__title">정보를 불러오지 못했어요</p>' +
      '<p class="load-error__desc">잠시 후 다시 시도해주세요</p></div>' +
      '<button class="btn btn--secondary" type="button">다시 시도</button>';
    box.querySelector('button').addEventListener('click', function () {
      var btn = this;
      btn.classList.add('is-loading');
      setTimeout(onRetry, 600);   /* 프로토타입: 다시 시도하면 정상 데이터로 */
    });
    return box;
  }

  return { state: state, won: won, num: num, esc: esc, loadError: loadError };
})();
