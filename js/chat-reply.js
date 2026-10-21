/* =========================================================
   코나비즈 — chat-reply.js (09 챗봇 답변)
   답변을 만드는 곳은 get() 하나 — POST /api/chat (FastAPI)
   - 빠른 답변 버튼은 서버의 규칙 답변, 직접 입력은 서버가 OpenAI로 답함. 답변 문구는 backend/app/chat_rules.py에만
   - 여기에는 버튼 id·이름만 둠 (칩을 그리는 데 필요)
   - 429·422는 서버 문구를 답변처럼 보여줌. 서버에 닿지 못하면 reject → chatbot.js의 실패 표시([다시 보내기])
   ?chat=error → 첫 요청만 실패 (다시 보내기는 성공)
   ========================================================= */
window.KonaChatReply = (function () {
  'use strict';

  /* 퀵 리플라이 칩 (기획서 9.6) — id는 chat_rules.ANSWERS와 같음 */
  var QUICK_REPLIES = [
    { id: 'lead-time', label: '도입까지 얼마나 걸리나요?' },
    { id: 'limits', label: '결제 제한은 어떻게 설정하나요?' },
    { id: 'pricing', label: '비용이 궁금해요' },
    { id: 'booking', label: '상담 예약하고 싶어요' }
  ];

  var failOnce = new URLSearchParams(window.location.search).get('chat') === 'error';

  /* message: 사용자가 보낸 문장
     opts: { quickReplyId, anonId, conversationId }
     → Promise<{ text, cta, sources }> (cta: 'booking' | 'simulator' | 없음. 서버에 닿지 못하면 reject)
     sources: AI가 근거로 쓴 안내의 카테고리 이름(중복 없이, 순서 유지). 없으면 undefined */
  function categories(sources) {
    if (!Array.isArray(sources)) return undefined;
    var out = [];
    sources.forEach(function (s) {
      var c = s && typeof s.category === 'string' ? s.category : '';
      if (c && out.indexOf(c) < 0) out.push(c);
    });
    return out.length ? out : undefined;
  }

  function get(message, opts) {
    opts = opts || {};
    if (failOnce) { failOnce = false; return Promise.reject(new Error('mock-error')); }
    /* 버튼 이름과 똑같이 입력해도 빠른 답변으로 */
    var quickId = opts.quickReplyId || (QUICK_REPLIES.filter(function (q) { return q.label === message.trim(); })[0] || {}).id;
    var body = { message: message, conversation_id: opts.conversationId, anon_id: opts.anonId };
    if (quickId) body.quick_reply_id = quickId;
    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && typeof data.text === 'string') return { text: data.text, cta: data.cta || undefined, sources: categories(data.sources) };
        if ((res.status === 429 || res.status === 422) && typeof data.detail === 'string') return { text: data.detail };
        throw new Error(String(res.status));
      });
    });
  }

  return { QUICK_REPLIES: QUICK_REPLIES, get: get };
})();
