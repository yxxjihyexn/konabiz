/* =========================================================
   코나비즈 — classifier.js (AI 가맹점 판별기, 공통)
   랜딩 AI 카드 · 임직원 마이페이지 · 관리자 대시보드에서 같이 씀
   KonaClassifier.mount(el, { chips: [이름…], balances: function () { return {meal, …} | null } })
   - POST /api/ml/classify {name} → {category, confidence, industry, source, level}
   - 화면은 서버가 계산한 level만 보고 그림 (block · warn · high · low)
   - 결과 영역은 role="status" — 결과·실패 문장을 스크린리더가 읽음
   ========================================================= */
window.KonaClassifier = (function () {
  'use strict';

  var MAX_LEN = 50;   /* backend ml_rules.NAME_MAX_LEN */
  var POCKET = { meal: '식대P', fitness: '체력단련P', welfare: '복지P', expense: '법인경비P' };
  var IDLE = '가맹점 이름을 넣으면 어떤 포인트로 결제될지 알려드려요';
  var FAIL = '지금은 판별할 수 없어요. 잠시 후 다시 시도해주세요.';
  var NOTE = '실제 결제는 가맹점에 등록된 업종으로 처리돼요. AI는 미리 알려드리는 역할이에요.';

  var uid = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }

  function icon(name) { return '<img class="classifier__icon" src="assets/' + name + '" alt="" width="20" height="20">'; }

  function fact(label, value) {
    return '<div class="classifier__fact"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }

  /* level → 결과 영역 (class, html) */
  function resultView(r, balances) {
    var high = r.level === 'high' || r.level === 'warn';
    var method = '<p class="classifier__method"><span class="badge-status badge-status--ai">AI</span>' +
      (r.source === 'rule' ? '제한 업종 규칙' : 'AI 판별') + '</p>';
    /* 모델 확률은 100%가 아니므로 99%까지만 (0.996 → 100%로 보이면 과신처럼 읽힘) */
    var score = Math.min(99, Math.round(r.confidence * 100)) + '% · ' + (high ? '높음' : '낮음');
    var basis = fact('근거 업종', esc(r.industry));

    if (r.level === 'block') {
      return { cls: 'is-block', html: method +
        '<p class="classifier__headline">' + icon('icon-stop-danger.svg') + '결제할 수 없어요 · 제한 업종</p>' +
        '<dl class="classifier__facts">' + basis + '</dl>' };
    }
    if (r.category === 'restricted') {   /* 모델 판정 — 차단으로 단정하지 않음 */
      var warn = r.level === 'warn';
      return { cls: warn ? 'is-warn' : 'is-low', html: method +
        '<p class="classifier__headline">' + icon(warn ? 'icon-alert-ink.svg' : 'icon-info.svg') +
          (warn ? '제한 업종일 수 있어요' : '제한 업종일 수도 있어요') + '</p>' +
        '<dl class="classifier__facts">' + fact('확신도', score) + basis + '</dl>' +
        '<p class="classifier__hint">' + (warn ? 'AI 판정이라 결제 불가로 단정하지 않아요. 결제 전에 업종을 확인해주세요.'
                                                : '이름만으로는 확실하지 않아요.') + '</p>' };
    }

    var name = POCKET[r.category];
    var bal = balances && balances();
    return { cls: r.level === 'high' ? 'is-high' : 'is-low', html: method +
      '<p class="classifier__headline">' + icon(r.level === 'high' ? 'icon-check-green.svg' : 'icon-info.svg') +
        name + '로 결제될 것 같아요</p>' +
      '<dl class="classifier__facts">' + fact('포인트', '<span class="tag">' + name + '</span>') + fact('확신도', score) + basis +
        (bal && bal[r.category] != null ? fact('남은 ' + name, won(bal[r.category])) : '') + '</dl>' +
      (r.level === 'low' ? '<p class="classifier__hint">이름만으로는 확실하지 않아요.</p>' : '') };
  }

  function mount(el, opts) {
    opts = opts || {};
    var id = 'classifier-' + (++uid);
    el.classList.add('classifier');
    el.innerHTML =
      '<form class="classifier__form" novalidate>' +
        '<label class="visually-hidden" for="' + id + '-name">가맹점 이름</label>' +
        '<div class="classifier__row">' +
          '<div class="field__control classifier__control">' +
            '<input id="' + id + '-name" class="field__input" type="text" maxlength="' + MAX_LEN + '" autocomplete="off" ' +
            'placeholder="가맹점 이름을 입력해보세요"></div>' +
          '<button class="btn btn--primary classifier__submit" type="submit" disabled>판별하기</button>' +
        '</div>' +
      '</form>' +
      (opts.chips && opts.chips.length
        ? '<div class="chip-group" role="group" aria-labelledby="' + id + '-chips"><p id="' + id + '-chips" class="chip-group__title">눌러서 바로 판별해보세요</p>' +
          '<div class="chip-group__row">' + opts.chips.map(function (c) {
            return '<button class="chip-toggle chip-quick" type="button" data-chip>' + esc(c) + '</button>';
          }).join('') + '</div></div>'
        : '') +
      '<div class="result-box classifier__result" role="status" aria-live="polite"><p class="result-box__idle">' + IDLE + '</p></div>' +
      '<p class="classifier__note">' + NOTE + '</p>';

    var form = el.querySelector('form');
    var input = el.querySelector('input');
    var submit = el.querySelector('.classifier__submit');
    var result = el.querySelector('.classifier__result');
    var chips = el.querySelectorAll('[data-chip]');
    var busy = false;

    function sync() { submit.disabled = busy || !input.value.trim(); }

    function setBusy(on) {
      busy = on;
      input.disabled = on;
      submit.textContent = on ? '판별 중…' : '판별하기';
      chips.forEach(function (c) { c.disabled = on; });
      if (on) result.setAttribute('aria-busy', 'true'); else result.removeAttribute('aria-busy');
      sync();
    }

    function show(cls, html) {
      result.className = 'result-box classifier__result' + (cls ? ' ' + cls : '');
      result.innerHTML = html;
    }

    function fail(msg) {
      show('is-fail', '<p class="classifier__headline">' + icon('icon-alert.svg') + esc(msg || FAIL) + '</p>');
    }

    /* 결과 자리를 처음부터 잡아둠 (기획서 7.1) — 지금 폭에서 높음 · 차단 예시를 화면 밖에 그려 더 큰 높이를
       결과 상자 최소 높이로. 처음 → 결과로 바뀔 때 높이가 변하지 않게. 폭이 바뀌면 다시 잼 */
    var SAMPLES = [
      { category: 'fitness', confidence: 0.99, industry: '예체능·기타 학원', source: 'model', level: 'high' },
      { category: 'restricted', confidence: 1, industry: '유흥주점 키워드', source: 'rule', level: 'block' }
    ];
    var sampleBalances = opts.balances ? function () { return { meal: 100000, fitness: 100000, welfare: 100000, expense: 500000 }; } : null;
    var reservedFor = -1;
    function reserve() {
      var width = result.getBoundingClientRect().width;
      if (!width || Math.abs(width - reservedFor) < 1) return;
      reservedFor = width;
      var probe = result.cloneNode(false);
      probe.removeAttribute('role');
      probe.removeAttribute('aria-live');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;min-height:0;width:' + width + 'px';
      el.appendChild(probe);
      var max = 0;
      SAMPLES.forEach(function (s) {
        var v = resultView(s, sampleBalances);
        probe.className = 'result-box classifier__result ' + v.cls;
        probe.innerHTML = v.html;
        max = Math.max(max, probe.getBoundingClientRect().height);
      });
      probe.remove();
      result.style.minHeight = Math.ceil(max) + 'px';
    }
    reserve();
    /* 웹폰트가 늦게 오면 글자 높이가 달라지므로 한 번 더 */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { reservedFor = -1; reserve(); });
    if (window.ResizeObserver) new ResizeObserver(reserve).observe(result);
    else window.addEventListener('resize', reserve);

    function run(name) {
      name = name.trim();
      if (!name || busy) return;
      /* 요청 중 비활성으로 포커스가 사라지므로 끝나면 되돌림 (Enter → 입력칸, 칩 → 그 칩) */
      var back = el.contains(document.activeElement) ? document.activeElement : null;
      if (back === submit) back = input;
      setBusy(true);
      fetch('/api/ml/classify', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok) {
            var v = resultView(data, opts.balances);
            show(v.cls, v.html);
          } else if ((res.status === 429 || res.status === 422) && typeof data.detail === 'string') {
            fail(data.detail);
          } else {
            fail();
          }
        });
      }).catch(function () {
        fail();
      }).then(function () {
        setBusy(false);
        if (back) back.focus();
      });
    }

    input.addEventListener('input', sync);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      run(input.value);
    });
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        input.value = c.textContent;
        run(c.textContent);
      });
    });
  }

  return { mount: mount };
})();
