/* =========================================================
   코나비즈 — mock-data.js
   기획서 9.7 예시(mock) 데이터. 화면 간 숫자가 서로 맞도록 한곳에서 관리
   TODO(백엔드): FastAPI 응답으로 교체
   ========================================================= */
window.KonaMock = (function () {
  'use strict';

  var company = '가나다테크(주)';

  /* 05 관리자 대시보드
     사용액 8,420,000 = 부서별 합계 = 카테고리별 합계(법인경비P 포함) / 활성 카드 24 = 부서별 카드 합계 */
  var admin = {
    user: { name: '김철수', meta: company + ' · 관리자' },
    period: '10월 1일 ~ 10월 16일 기준',
    budget: 10000000,
    blockedCount: 3,
    departments: [
      { name: '영업1팀', cards: 8, amount: 3120000 },
      { name: '마케팅팀', cards: 7, amount: 2480000 },
      { name: '개발팀', cards: 9, amount: 2820000 }
    ],
    categories: [
      { name: '식대P', used: 3368000, budget: 4000000 },
      { name: '체력단련P', used: 1950000, budget: 2500000 },
      { name: '복지P', used: 1820000, budget: 2000000 }
    ],
    expense: { name: '법인경비P (별도 예산)', used: 1282000 },
    alerts: [
      { ok: false, title: '유흥주점 결제 차단', meta: '영업1팀 · 10분 전' },
      { ok: true, title: '커피전문점 결제 승인', meta: '개발팀 · 32분 전' },
      { ok: true, title: '일반음식점 결제 승인', meta: '마케팅팀 · 1시간 전' },
      { ok: false, title: '결제 가능 시간 외 결제 차단', meta: '영업1팀 · 어제 23:12' }
    ]
  };

  /* 06 임직원 마이페이지 (김민준 · 개발팀 · 카드 끝 4821)
     시작 잔액 150,000 / 100,000 / 100,000 / 500,000 → 남은 잔액 120,000 / 70,000 / 82,000 / 488,000
     합계(법인경비P 제외) 272,000. 차단 결제는 차감 없음 */
  var employee = {
    user: { name: '김민준', meta: company + ' · 개발팀' },
    card: { last4: '4821', holder: '김민준' },
    start: { meal: 150000, fitness: 100000, welfare: 100000, expense: 500000 },
    payments: [
      { date: '10/16', merchant: '스타벅스 강남점', pocket: 'meal', amount: 4500 },
      { date: '10/15', merchant: '라운지바 강남', blocked: '유흥주점은 제한 업종이에요', amount: 30000 },
      { date: '10/14', merchant: '애니타임피트니스', pocket: 'fitness', amount: 30000 },
      { date: '10/13', merchant: '교보문고', pocket: 'welfare', amount: 18000 },
      { date: '10/12', merchant: '오피스디포', pocket: 'expense', amount: 12000 },
      { date: '10/10', merchant: '김밥천국', pocket: 'meal', amount: 7500 },
      { date: '10/08', merchant: '한솥도시락', pocket: 'meal', amount: 18000 }
    ]
  };

  /* 07 Sandbox — 사이드바 계정은 예시 문구 (숫자가 예시라 고객의 실제 회사명과 섞이지 않게) */
  var sandbox = {
    admin: { name: '체험 관리자', meta: '예시 회사 · 관리자' },
    employee: { name: '김민준 님', meta: '예시 회사 · 개발팀' }
  };

  var POCKET_NAME ={ meal: '식대P', fitness: '체력단련P', welfare: '복지P', expense: '법인경비P' };

  /* 남은 잔액 = 시작 잔액 − 승인 결제 (차단은 차감 없음) */
  function balances(start, payments) {
    var b = Object.assign({}, start);
    payments.forEach(function (p) { if (!p.blocked) b[p.pocket] -= p.amount; });
    return b;
  }

  return { company: company, admin: admin, employee: employee, sandbox: sandbox, POCKET_NAME: POCKET_NAME, balances: balances };
})();
