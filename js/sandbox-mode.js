/* =========================================================
   코나비즈 — sandbox-mode.js (07 Sandbox 본문)
   admin.html · employee.html을 sandbox.html의 iframe으로 띄울 때(?sandbox=1)만 동작
   - 사이드바 계정은 예시 문구, [로그아웃] 숨김, 임직원관리 메뉴 비활성("체험 불가")
   - 대시보드·마이페이지 밖으로 나가는 버튼·링크 → 토스트 Info, 화면은 그대로
   app.js보다 먼저 실행 — 드로어가 바뀐 사이드바를 그대로 복사하게
   ========================================================= */
(function () {
  'use strict';

  if (new URLSearchParams(window.location.search).get('sandbox') !== '1') return;

  var role = document.body.getAttribute('data-app');   /* admin | employee */
  var page = role + '.html';
  document.documentElement.classList.add('is-sandbox');

  /* ---------- 사이드바 ---------- */
  var account = KonaMock.sandbox[role];
  document.querySelector('.sidebar__name').textContent = account.name;
  document.querySelector('.sidebar__meta').textContent = account.meta;

  var logout = document.querySelector('.sidebar a[href="index.html"]');
  if (logout) logout.remove();

  var members = document.querySelector('.sidebar a[href="admin-members.html"]');
  if (members) {
    var off = document.createElement('span');
    off.className = 'sidebar__link';
    off.setAttribute('aria-disabled', 'true');
    off.innerHTML = '임직원관리 <span class="sidebar__soon">체험 불가</span>';
    members.replaceWith(off);
  }

  /* ---------- 클릭 가로채기 (capture — 각 요소의 동작보다 먼저) ----------
     그대로 둠: 드로어 열기·닫기, 챗봇 FAB·패널(정상 동작), AI 판별기(실제 API — 데이터를 바꾸지 않음), 본문 바로가기
     지금 화면 링크(로고 · 선택된 메뉴): 이동 없이 머묾 (주소의 ?sandbox=1이 빠지지 않게)
     그 밖: 토스트 */
  var MSG = '체험 화면에서는 실제로 실행되지 않아요';

  document.addEventListener('click', function (e) {
    var el = e.target.closest('a[href], button');
    if (!el) return;
    if (el.matches('[aria-controls="drawer"], [data-drawer-close], .fab-chatbot, .chat-panel button, .classifier button, a[href^="#"]')) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    if (el.tagName === 'A' && el.getAttribute('href') === page) {
      if (window.KonaDrawer) window.KonaDrawer.close();
      return;
    }
    Kona.toast(MSG, 'info');
  }, true);
})();
