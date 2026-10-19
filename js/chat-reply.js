/* =========================================================
   코나비즈 — chat-reply.js (09 챗봇 답변)
   답변을 만드는 곳은 get() 하나 — FastAPI 연결 시 이 함수 본문만 fetch로 바꿈
   지금은 서버가 없어 예시 문구를 1초 뒤에 돌려줌
   ?chat=error → 첫 요청만 실패 (다시 보내기는 성공)
   ========================================================= */
window.KonaChatReply = (function () {
  'use strict';

  /* 퀵 리플라이 칩 (기획서 9.6) */
  var QUICK_REPLIES = [
    { id: 'lead-time', label: '도입까지 얼마나 걸리나요?' },
    { id: 'limits', label: '결제 제한은 어떻게 설정하나요?' },
    { id: 'pricing', label: '비용이 궁금해요' },
    { id: 'booking', label: '상담 예약하고 싶어요' }
  ];

  /* cta: 'booking' → 답변 안 [상담 예약하기] */
  var ANSWERS = {
    'lead-time': { text: '계약 후 카드 수령까지 약 20일이 걸려요. 회사 상황에 맞는 일정은 상담에서 안내해 드릴게요', cta: 'booking' },
    'limits': { text: '관리자 대시보드에서 부서·임직원별로 사용 시간, 한도, 업종을 정할 수 있어요. 정한 규칙은 결제하는 순간 바로 적용돼요.' },
    'pricing': { text: '도입비는 최초 1회 30만 원이고, 월 이용료는 2026년 12월 31일까지 계약하면 평생 0원이에요. 카드 제작비는 장당 8,000원부터예요. 회사 규모에 맞는 정확한 견적은 상담에서 안내해 드릴게요.', cta: 'booking' },
    'booking': { text: '5분이면 상담 시간까지 정할 수 있어요. 아래 버튼으로 예약해 주세요.', cta: 'booking' }
  };
  /* 직접 입력한 질문 — 지어내지 않고 상담 안내 */
  var FALLBACK = { text: '정확한 안내는 상담에서 도와드려요', cta: 'booking' };

  var DELAY = 1000;
  var failOnce = new URLSearchParams(window.location.search).get('chat') === 'error';

  /* message: 사용자가 보낸 문장
     opts: { quickReplyId, anonId, conversationId }
     → Promise<{ text, cta }> (실패하면 reject) */
  function get(message, opts) {
    opts = opts || {};
    /* TODO(백엔드): FastAPI 연결 시 아래로 교체
       return fetch('/api/chat', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ anonId: opts.anonId, conversationId: opts.conversationId, message: message })
       }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); */
    var key = opts.quickReplyId || (QUICK_REPLIES.filter(function (q) { return q.label === message.trim(); })[0] || {}).id;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (failOnce) { failOnce = false; reject(new Error('mock-error')); return; }
        resolve(ANSWERS[key] || FALLBACK);
      }, DELAY);
    });
  }

  return { QUICK_REPLIES: QUICK_REPLIES, get: get };
})();
