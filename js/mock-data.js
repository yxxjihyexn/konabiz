/* =========================================================
   코나비즈 — mock-data.js
   기획서 9.7 예시(mock) 데이터. 화면 간 숫자가 서로 맞도록 한곳에서 관리
   TODO(백엔드): FastAPI 응답으로 교체
   ========================================================= */
window.KonaMock = (function () {
  'use strict';

  var company = '가나다테크(주)';

  /* 05 관리자 대시보드
     사용액 8,420,000 = 부서별 합계 = 카테고리별 합계(법인경비P 포함)
     활성 카드 수 · 부서별 카드 수는 members에서 계산 (activeCards · issuingCards) — 로그인 화면은 DB 기준 */
  var admin = {
    user: { name: '김철수', meta: company + ' · 관리자' },
    period: '10월 1일 ~ 10월 16일 기준',
    budget: 10000000,
    blockedCount: 3,
    departments: [
      { name: '영업1팀', amount: 3120000 },
      { name: '마케팅팀', amount: 2480000 },
      { name: '개발팀', amount: 2820000 }
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
     합계(법인경비P 제외) 272,000. 차단 결제는 차감 없음
     ai = 가맹점 판별 최종 모델 결과 (seed가 DB에 넣는 값과 같음 — 모델을 다시 학습하면 같이 고침) */
  function ai(category, confidence, industry, level, source) {
    return { category: category, confidence: confidence, industry: industry, source: source || 'model', level: level };
  }
  var employee = {
    user: { name: '김민준', meta: company + ' · 개발팀' },
    card: { last4: '4821', holder: '김민준' },
    start: { meal: 150000, fitness: 100000, welfare: 100000, expense: 500000 },
    payments: [
      { date: '10/16', merchant: '스타벅스 강남점', pocket: 'meal', amount: 4500, ai: ai('meal', 0.6255, '카페·음료점', 'high') },
      { date: '10/15', merchant: '블루문 유흥주점', blocked: '유흥주점은 제한 업종이에요', amount: 30000, ai: ai('restricted', 1.0, '유흥주점 키워드', 'block', 'rule') },
      { date: '10/14', merchant: '애니타임피트니스', pocket: 'fitness', amount: 30000, ai: ai('fitness', 0.996, '체육시설', 'high') },
      { date: '10/13', merchant: '올리브영 신촌점', pocket: 'welfare', amount: 18000, ai: ai('welfare', 0.8311, '생활용품 매장', 'high') },
      { date: '10/12', merchant: '오피스디포', pocket: 'expense', amount: 12000, ai: ai('expense', 0.9961, '문구점', 'high') },
      { date: '10/10', merchant: '김밥천국', pocket: 'meal', amount: 7500, ai: ai('meal', 0.9958, '분식·간편식', 'high') },
      { date: '10/08', merchant: '한솥도시락', pocket: 'meal', amount: 18000, ai: ai('meal', 0.9975, '한식', 'high') }
    ]
  };

  /* 08 임직원관리 — 총 24명, 초대일 최신순
     부서 3개: 영업1팀 8 · 마케팅팀 7 · 개발팀 9명 / 상태: 초대됨 3 · 사용 중 18 · 정지 2 · 회수됨 1
     활성 카드(사용 중) 18 = 영업1팀 5 + 마케팅팀 5 + 개발팀 8, 발급 중(초대됨) 3
     김민준(개발팀 · 4821)은 06 마이페이지 사용자와 같은 사람 */
  var DEPTS = ['영업1팀', '마케팅팀', '개발팀'];
  var today = '2026.10.16';   /* 기준 기간 마지막 날 — 새로 초대한 사람의 초대일 */

  var members = [
    ['윤채원', 'chaewon.yoon@company.co.kr', '마케팅팀', '9143', 'invited', '2026.10.11'],
    ['박지호', 'jiho.park@company.co.kr', '영업1팀', '7720', 'invited', '2026.10.10'],
    ['오시우', 'siwoo.oh@company.co.kr', '개발팀', '0419', 'active', '2026.09.15'],
    ['한소율', 'soyul.han@company.co.kr', '마케팅팀', '8370', 'active', '2026.09.12'],
    ['강도윤', 'doyun.kang@company.co.kr', '영업1팀', '2287', 'active', '2026.09.08'],
    ['정하늘', 'haneul.jung@company.co.kr', '개발팀', '6612', 'suspended', '2026.09.05'],
    ['최유진', 'yujin.choi.people-operations@company.co.kr', '마케팅팀', '3054', 'active', '2026.09.03'],
    ['김민준', 'minjun.kim@company.co.kr', '개발팀', '4821', 'active', '2026.09.01'],
    ['이서연', 'seoyeon.lee@company.co.kr', '마케팅팀', '1937', 'active', '2026.09.01'],
    ['임건우', 'geonwoo.lim@company.co.kr', '영업1팀', '5506', 'revoked', '2026.08.20'],
    ['송예준', 'yejun.song@company.co.kr', '개발팀', '3362', 'active', '2026.08.18'],
    ['문지아', 'jia.moon@company.co.kr', '영업1팀', '7045', 'active', '2026.08.14'],
    ['배서준', 'seojun.bae@company.co.kr', '개발팀', '1586', 'active', '2026.08.11'],
    ['조하린', 'harin.jo@company.co.kr', '마케팅팀', '9271', 'active', '2026.08.05'],
    ['신우진', 'woojin.shin@company.co.kr', '영업1팀', '4408', 'suspended', '2026.07.29'],
    ['권나은', 'naeun.kwon@company.co.kr', '개발팀', '6630', 'active', '2026.07.22'],
    ['황준서', 'junseo.hwang@company.co.kr', '영업1팀', '2754', 'active', '2026.07.15'],
    ['안수아', 'sua.ahn@company.co.kr', '마케팅팀', '8119', 'invited', '2026.07.08'],
    ['류도현', 'dohyun.ryu@company.co.kr', '개발팀', '5093', 'active', '2026.07.01'],
    ['홍지우', 'jiwoo.hong@company.co.kr', '영업1팀', '3817', 'active', '2026.06.24'],
    ['전시윤', 'siyun.jeon@company.co.kr', '개발팀', '7462', 'active', '2026.06.17'],
    ['고은서', 'eunseo.go@company.co.kr', '마케팅팀', '1208', 'active', '2026.06.10'],
    ['남현우', 'hyunwoo.nam@company.co.kr', '영업1팀', '6954', 'active', '2026.06.03'],
    ['서유나', 'yuna.seo@company.co.kr', '개발팀', '0873', 'active', '2026.06.01']
  ].map(function (r, i) {
    return { id: i + 1, name: r[0], email: r[1], dept: r[2], last4: r[3], status: r[4], invited: r[5] };
  });

  /* CSV 일괄 등록 예시 결과 (08_Members_CSVError) — 24행 중 5 · 12 · 18행이 오류, 나머지 21명 정상
     오류는 화면에서 다시 검사함 (이미 등록된 이메일은 그때그때 중복으로 판단) */
  var csvSample = {
    fileName: 'members_1013.csv',
    rows: [
      ['이도윤', 'doyun.lee@company.co.kr', '개발팀'],
      ['박서윤', 'seoyun.park@company.co.kr', '마케팅팀'],
      ['최하준', 'hajun.choi@company.co.kr', '영업1팀'],
      ['정유진', 'yujin.jung@company.co.kr', '개발팀'],
      ['김지훈', 'kim.jh@company', '영업1팀'],
      ['강민서', 'minseo.kang@company.co.kr', '마케팅팀'],
      ['윤지후', 'jihoo.yoon@company.co.kr', '영업1팀'],
      ['장서아', 'seoa.jang@company.co.kr', '개발팀'],
      ['임하은', 'haeun.lim@company.co.kr', '마케팅팀'],
      ['한도현', 'dohyeon.han@company.co.kr', '영업1팀'],
      ['오지민', 'jimin.oh@company.co.kr', '개발팀'],
      ['김민준', 'minjun.kim@company.co.kr', '개발팀'],
      ['서준혁', 'junhyuk.seo@company.co.kr', '영업1팀'],
      ['신예린', 'yerin.shin@company.co.kr', '마케팅팀'],
      ['권태윤', 'taeyun.kwon@company.co.kr', '개발팀'],
      ['황보람', 'boram.hwang@company.co.kr', '마케팅팀'],
      ['송민재', 'minjae.song@company.co.kr', '영업1팀'],
      ['', 'chaeeun.yu@company.co.kr', '개발팀'],
      ['노현서', 'hyunseo.noh@company.co.kr', '마케팅팀'],
      ['백승우', 'seungwoo.baek@company.co.kr', '영업1팀'],
      ['하지원', 'jiwon.ha@company.co.kr', '개발팀'],
      ['문채윤', 'chaeyun.moon@company.co.kr', '마케팅팀'],
      ['구민혁', 'minhyuk.koo@company.co.kr', '영업1팀'],
      ['유하람', 'haram.yu@company.co.kr', '개발팀']
    ].map(function (r, i) { return { row: i + 1, name: r[0], email: r[1], dept: r[2] }; })
  };

  /* 카드 수 — 활성 = 사용 중(active)만 18, 발급 중 = 초대됨 3 (/api/dashboard/summary와 같은 기준). dept를 주면 그 부서만 */
  function countCards(status, dept) {
    return members.filter(function (m) { return m.status === status && (!dept || m.dept === dept); }).length;
  }
  function activeCards(dept) { return countCards('active', dept); }
  function issuingCards(dept) { return countCards('invited', dept); }

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

  return {
    company: company, admin: admin, employee: employee, sandbox: sandbox,
    DEPTS: DEPTS, today: today, members: members, csvSample: csvSample, activeCards: activeCards, issuingCards: issuingCards,
    POCKET_NAME: POCKET_NAME, balances: balances
  };
})();
