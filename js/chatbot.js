/* =========================================================
   코나비즈 — chatbot.js (09 챗봇 플로팅 위젯, 전역)
   패널 마크업은 여기서 한 번 만듦 (HTML마다 복사하지 않음). 답변은 KonaChatReply.get()
   - 비모달: 오버레이·포커스 트랩 없음. FAB·ESC로 닫기, 모달이 열리면 자동으로 닫힘(입력 중 문구 유지)
   - 1024 이상·태블릿: 우측 하단 360 × 560 / 767 이하: 전체 화면, FAB 숨김, 헤더 닫기 버튼
   - 대화 기록: localStorage kona.chat (최근 20개). 답변을 기다리다 페이지를 옮기면 그 질문은 실패로 표시
     로그인 성공 → 새 대화 / 로그아웃([data-logout]) → 임시 ID까지 삭제
   - ?chat=error(첫 요청만 실패) · ?chat=offline → 패널을 연 채로 시작
   ========================================================= */
window.KonaChat = (function () {
  'use strict';

  var fab = document.querySelector('.fab-chatbot');
  var Reply = window.KonaChatReply;
  if (!fab || !Reply) return null;

  var KEY = 'kona.chat';
  var MAX_KEEP = 20;
  var MAX_LEN = 500;
  var COUNT_FROM = 450;
  var TIMEOUT = 20000;
  var chatParam = new URLSearchParams(window.location.search).get('chat');
  var forceOffline = chatParam === 'offline';
  var mobile = window.matchMedia('(max-width: 767px)');

  /* ---------- 저장 ---------- */
  var newId = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 무시 */ }
    if (!s || !Array.isArray(s.messages)) s = { messages: [] };
    s.anonId = s.anonId || newId();
    s.conversationId = s.conversationId || newId();
    return s;
  }
  function save() {
    state.messages = state.messages.slice(-MAX_KEEP);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }

  var state = load();
  /* 답변을 기다리다 페이지를 떠났던 질문 → 실패로 (다시 보내기 가능) */
  if (state.pending) {
    state.messages.forEach(function (m) { if (m.id === state.pending) m.failed = true; });
    state.pending = null;
    save();
  }

  /* ---------- 마크업 ---------- */
  var panel = document.createElement('section');
  panel.id = 'chat-panel';
  panel.className = 'chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'chat-title');
  panel.tabIndex = -1;
  panel.hidden = true;
  panel.innerHTML =
    '<header class="chat-header">' +
      '<div class="chat-header__text">' +
        '<div class="chat-header__row">' +
          '<h2 id="chat-title" class="chat-header__title">코나비즈 도우미</h2>' +
          '<span class="badge-status badge-status--ai">AI</span>' +
        '</div>' +
        '<p class="chat-header__desc">AI가 답변해요 · 정확한 안내는 상담에서 도와드려요</p>' +
      '</div>' +
      '<button class="icon-btn" type="button" aria-label="새 대화 시작" title="새 대화 시작" data-chat-new>' +
        '<img src="assets/icon-edit.svg" alt="" width="20" height="20"></button>' +
      '<button class="icon-btn chat-header__close" type="button" aria-label="챗봇 닫기" data-chat-close>' +
        '<img src="assets/icon-close.svg" alt="" width="20" height="20"></button>' +
    '</header>' +
    '<div class="chat-body" data-chat-body>' +
      '<div class="chat-msg chat-msg--bot"><div class="chat-bubble"><p class="chat-bubble__text">' +
        '안녕하세요! 코나비즈 도우미예요. 도입 절차, 결제 정책, 이용 방법까지 궁금한 점을 물어보세요.</p></div></div>' +
      '<p class="chat-notice"><img src="assets/icon-info.svg" alt="" width="16" height="16">카드번호·비밀번호 같은 개인정보는 입력하지 마세요.</p>' +
      '<div class="chat-quick" role="group" aria-label="자주 묻는 질문" data-chat-quick>' +
        Reply.QUICK_REPLIES.map(function (q) {
          return '<button class="chip-toggle chip-quick" type="button" data-quick="' + q.id + '">' + q.label + '</button>';
        }).join('') +
      '</div>' +
      '<div class="chat-log" role="log" aria-live="polite" aria-label="대화 내용" data-chat-log></div>' +
    '</div>' +
    '<p class="chat-offline" role="status" data-chat-offline hidden>' +
      '<img src="assets/icon-info.svg" alt="" width="16" height="16">인터넷 연결을 확인해주세요. 연결되면 다시 보낼 수 있어요.</p>' +
    '<form class="chat-input" data-chat-form novalidate>' +
      '<p class="chat-input__count" aria-live="polite" data-chat-count hidden></p>' +
      '<div class="chat-input__row">' +
        '<label class="visually-hidden" for="chat-text">궁금한 점 입력</label>' +
        '<textarea id="chat-text" class="chat-input__text" rows="1" maxlength="' + MAX_LEN + '" placeholder="궁금한 점을 입력하세요"></textarea>' +
        '<button class="chat-send" type="submit" aria-label="보내기" disabled>' +
          '<img src="assets/icon-send.svg" alt="" width="20" height="20"></button>' +
      '</div>' +
    '</form>';
  fab.insertAdjacentElement('beforebegin', panel);   /* 탭 순서: 패널 → FAB */

  var $ = function (sel) { return panel.querySelector(sel); };
  var body = $('[data-chat-body]');
  var log = $('[data-chat-log]');
  var quick = $('[data-chat-quick]');
  var newBtn = $('[data-chat-new]');
  var offlineBar = $('[data-chat-offline]');
  var form = $('[data-chat-form]');
  var input = $('#chat-text');
  var count = $('[data-chat-count]');
  var sendBtn = $('.chat-send');
  var fabIcon = fab.querySelector('img');

  /* ---------- 그리기 ---------- */
  var CTA = { booking: '상담 예약하기', simulator: '무료로 체험하기' };   /* 답변 아래 버튼 */

  function botNode(m) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg--bot';
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    var p = document.createElement('p');
    p.className = 'chat-bubble__text';
    p.textContent = m.text;
    bubble.appendChild(p);
    if (CTA[m.cta]) {
      var b = document.createElement('button');
      b.className = 'btn btn--secondary btn--block';
      b.type = 'button';
      b.setAttribute('data-chat-' + m.cta, '');
      b.textContent = CTA[m.cta];
      bubble.appendChild(b);
    }
    wrap.appendChild(bubble);
    return wrap;
  }

  function userNode(m) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg--user';
    wrap.setAttribute('data-msg', m.id);
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    var p = document.createElement('p');
    p.className = 'chat-bubble__text';
    p.textContent = m.text;
    bubble.appendChild(p);
    wrap.appendChild(bubble);
    if (m.failed) wrap.appendChild(failNode());
    return wrap;
  }

  function failNode() {
    var f = document.createElement('div');
    f.className = 'chat-fail';
    f.innerHTML =
      '<p class="chat-fail__text"><img src="assets/icon-alert-error.svg" alt="" width="16" height="16">답변을 받지 못했어요.</p>' +
      '<button class="text-link text-link--cyan text-link--strong chat-fail__retry" type="button" data-chat-retry>다시 보내기</button>';
    f.querySelector('button').disabled = isOffline();
    return f;
  }

  function typingNode() {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg--bot';
    wrap.setAttribute('data-chat-typing', '');
    wrap.innerHTML = '<div class="chat-bubble chat-typing"><span class="visually-hidden">답변을 준비하고 있어요</span>' +
      '<span class="chat-typing__dot" aria-hidden="true"></span><span class="chat-typing__dot" aria-hidden="true"></span><span class="chat-typing__dot" aria-hidden="true"></span></div>';
    return wrap;
  }

  function nodeFor(m) { return m.from === 'user' ? userNode(m) : botNode(m); }

  /* 전체 다시 그리기 — 처음 · 새 대화 · 다른 창(Sandbox iframe)에서 바뀐 값 받을 때 */
  function renderAll() {
    log.textContent = '';
    state.messages.forEach(function (m) { log.appendChild(nodeFor(m)); });
    if (state.pending) log.appendChild(typingNode());
    quick.hidden = state.messages.length > 0;
    updateControls();
    updateFab();
    scrollToEnd(true);
  }

  /* 위로 스크롤해 이전 대화를 보는 중이면 자동으로 내리지 않음 */
  function nearBottom() { return body.scrollHeight - body.scrollTop - body.clientHeight < 40; }
  function scrollToEnd(force) {
    if (force || nearBottom()) body.scrollTop = body.scrollHeight;
  }
  function append(node, force) {
    var stick = force || nearBottom();
    log.appendChild(node);
    if (stick) body.scrollTop = body.scrollHeight;
  }
  function removeTyping() {
    var t = log.querySelector('[data-chat-typing]');
    if (t) t.remove();
  }

  /* ---------- 버튼 상태 ---------- */
  function isOffline() { return forceOffline || navigator.onLine === false; }

  function updateControls() {
    var off = isOffline();
    var waiting = !!state.pending;
    offlineBar.hidden = !off;
    sendBtn.disabled = off || waiting || !input.value.trim();
    quick.querySelectorAll('button').forEach(function (b) { b.disabled = off; });
    log.querySelectorAll('[data-chat-retry]').forEach(function (b) { b.disabled = off || waiting; });
    var empty = state.messages.length === 0 && !waiting;
    newBtn.disabled = empty;
    newBtn.querySelector('img').src = empty ? 'assets/icon-edit-disabled.svg' : 'assets/icon-edit.svg';
  }

  function updateFab() {
    var open = !panel.hidden;
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? '챗봇 닫기' : state.unread ? '챗봇 열기, 새 메시지 있음' : '챗봇 열기');
    fab.classList.toggle('has-unread', !open && !!state.unread);
    fabIcon.src = open ? 'assets/icon-close.svg' : 'assets/icon-chat.svg';
  }

  /* ---------- 입력칸: 최대 4줄까지 늘어남, 450자부터 글자 수 ---------- */
  function fitInput() {
    if (!panel.hidden) {   /* 닫혀 있으면 높이를 잴 수 없음 — 열 때 다시 맞춤 */
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';   /* 최소·최대 높이는 CSS */
    }
    var n = input.value.length;
    count.hidden = n < COUNT_FROM;
    count.textContent = n + '/' + MAX_LEN;
    updateControls();
  }

  /* ---------- 보내기 ---------- */
  var token = 0;   /* [새 대화 시작] 뒤에 늦게 온 답변은 버림 */

  function send(text, quickReplyId) {
    text = text.trim();
    if (!text || state.pending || isOffline()) return;
    var m = { id: newId(), from: 'user', text: text.slice(0, MAX_LEN) };
    if (quickReplyId) m.quick = quickReplyId;
    state.messages.push(m);
    quick.hidden = true;
    save();
    append(userNode(m), true);
    request(m);
  }

  function request(m) {
    var mine = token;
    state.pending = m.id;
    save();
    append(typingNode(), true);
    updateControls();

    var timer;
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT);
    });
    Promise.race([Reply.get(m.text, { quickReplyId: m.quick, anonId: state.anonId, conversationId: state.conversationId }), timeout])
      .then(function (res) {
        if (mine !== token) return;
        var a = { id: newId(), from: 'bot', text: res.text };
        if (res.cta) a.cta = res.cta;
        state.messages.push(a);
        state.pending = null;
        if (panel.hidden) state.unread = true;   /* 기다리는 중에 닫았으면 FAB 빨간 점 */
        save();
        removeTyping();
        append(botNode(a));
        updateControls();
        updateFab();
      }, function () {
        if (mine !== token) return;
        m.failed = true;
        state.pending = null;
        save();
        removeTyping();
        var node = log.querySelector('[data-msg="' + m.id + '"]');
        if (node) node.appendChild(failNode());
        scrollToEnd();
        updateControls();
      })
      .then(function () { clearTimeout(timer); });
  }

  function retry(id) {
    var m = state.messages.filter(function (x) { return x.id === id; })[0];
    if (!m || state.pending || isOffline()) return;
    delete m.failed;
    var node = log.querySelector('[data-msg="' + id + '"] .chat-fail');
    if (node) node.remove();
    request(m);
    focusInput();
  }

  /* 새 대화: 화면을 First로. 서버 연결 후에는 이전 기록이 서버에 남음 */
  function newConversation() {
    token++;
    state.messages = [];
    state.pending = null;
    state.unread = false;
    state.conversationId = newId();
    save();
    renderAll();
  }

  /* 로그인 성공 → 새 대화 / 로그아웃 → 임시 ID까지 지움 */
  function clear(dropId) {
    token++;
    if (dropId) {
      try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
      state = load();
      renderAll();
    } else {
      newConversation();
    }
  }

  /* ---------- 열기 · 닫기 ---------- */
  function open() {
    if (!panel.hidden) return;
    if (window.Kona && Kona.currentModal()) return;
    panel.hidden = false;
    state.unread = false;
    save();
    updateFab();
    if (mobile.matches) { document.body.classList.add('is-locked'); fitViewport(); }
    fitInput();
    scrollToEnd(true);
    requestAnimationFrame(function () { panel.classList.add('is-open'); });
    /* 모바일은 입력칸에 포커스하지 않음 — 키보드가 대화를 가리지 않게 */
    if (mobile.matches) panel.focus({ preventScroll: true });
    else input.focus({ preventScroll: true });
  }

  /* keepFocus: 모달이 열리면서 닫힐 때는 포커스를 FAB로 옮기지 않음 */
  function close(keepFocus) {
    if (panel.hidden) return;
    var hadFocus = panel.contains(document.activeElement);
    panel.classList.remove('is-open');
    panel.hidden = true;
    document.body.classList.remove('is-locked');
    updateFab();
    if (hadFocus && !keepFocus) fab.focus({ preventScroll: true });
  }

  /* 모바일 전체 화면: 키보드가 올라오면 보이는 영역 높이에 맞춤(입력 영역이 키보드 바로 위) */
  function fitViewport() {
    var vv = window.visualViewport;
    if (!vv || !mobile.matches || panel.hidden) { panel.style.height = ''; panel.style.top = ''; return; }
    panel.style.height = vv.height + 'px';
    panel.style.top = vv.offsetTop + 'px';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  mobile.addEventListener('change', function () {
    if (panel.hidden) return;
    document.body.classList.toggle('is-locked', mobile.matches);
    fitViewport();
  });

  /* 칩·다시 보내기·새 대화 뒤 입력칸으로. 모바일은 키보드가 올라오지 않게 그대로 */
  function focusInput() {
    if (!mobile.matches) input.focus({ preventScroll: true });
  }

  /* ---------- 바깥에서 질문 보내기 (랜딩 AI 섹션 칩) ----------
     직접 입력과 같은 경로(quickReplyId 없음). 답변을 기다리는 중·오프라인·모달 위에서는 보내지 않음(send가 막음) */
  function ask(text) {
    open();
    if (panel.hidden) return false;
    var before = state.messages.length;
    send(String(text || ''));
    return state.messages.length > before;
  }

  /* ---------- [상담 예약하기] · [무료로 체험하기] ----------
     랜딩: 그 모달을 바로 (opener = FAB → 포커스 복귀 · 유입 경로 "chatbot")
     다른 페이지: index.html?action=booking|simulator로 이동 (Sandbox iframe은 바깥 창) */
  function openFromChat(action) {
    if (document.getElementById('modal-' + action)) {
      Kona.openModal('modal-' + action, fab);
      return;
    }
    var url = new URL('index.html?action=' + action + '&source=chatbot', window.location.href).href;
    if (window.top !== window) window.top.location.href = url;
    else window.location.href = url;
  }

  /* ---------- 이벤트 ---------- */
  fab.addEventListener('click', function () {
    if (panel.hidden) open(); else close();
  });

  panel.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-quick')) {
      send(t.textContent, t.getAttribute('data-quick'));
      focusInput();
    } else if (t.hasAttribute('data-chat-retry')) {
      retry(t.closest('[data-msg]').getAttribute('data-msg'));
    } else if (t.hasAttribute('data-chat-booking')) {
      openFromChat('booking');
    } else if (t.hasAttribute('data-chat-simulator')) {
      openFromChat('simulator');
    } else if (t.hasAttribute('data-chat-new')) {
      newConversation();
      focusInput();
    } else if (t.hasAttribute('data-chat-close')) {
      close();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sendBtn.disabled) return;
    var text = input.value;
    input.value = '';
    fitInput();
    send(text);
  });

  /* Enter 전송 · Shift+Enter 줄바꿈 · 한글 조합 중 Enter 무시 */
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
  });
  input.addEventListener('input', fitInput);

  /* ESC: 포커스가 패널이나 FAB에 있을 때만 (모달이 열려 있으면 모달이 먼저) */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || panel.hidden) return;
    if (window.Kona && Kona.currentModal()) return;
    var a = document.activeElement;
    if (!panel.contains(a) && a !== fab) return;
    e.preventDefault();
    close();
    fab.focus({ preventScroll: true });
  });

  /* 로그아웃: 임시 ID 삭제 + 패널 비움 (드로어에 복사된 링크 포함) */
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-logout]')) clear(true);
  });

  window.addEventListener('online', updateControls);
  window.addEventListener('offline', updateControls);

  /* 다른 창(Sandbox의 다른 iframe · 다른 탭)에서 바뀐 대화 받기 */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY && e.key !== null) return;
    state = load();
    if (!panel.hidden && state.unread) { state.unread = false; save(); }
    renderAll();
  });

  /* ---------- 시작 ---------- */
  fab.setAttribute('aria-controls', 'chat-panel');
  renderAll();
  fitInput();
  if (chatParam) open();

  return { open: open, close: close, clear: clear, ask: ask };
})();
