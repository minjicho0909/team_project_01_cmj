// 화면 흐름: 안전 확인 → 버튼/자유 입력 → (자유 입력이면) "이렇게 이해했어요" 확인·수정 → 부족한 항목 버튼으로 되묻기
// → 규칙표 분류 → 결과(색깔 상자 · 맞은 규칙 줄 · 할 일 · 기관 · 관련 법령 · 증거 정리표 · 더 궁금한 점 묻기)
// 아무것도 저장하지 않는다(이 탭의 메모리에만 있고 새로고침하면 사라진다).

import { FACT_LABELS, classify, hasCrisis, RESULT_META } from './rules.js';
import { QUESTIONS, SITUATION_Q_MISTRANSFER, guidance, disputeMessage, DISCLAIMER, CENTER } from './content.js';
import { buildSheet, downloadText } from './sheet.js';

const $ = (s, el = document) => el.querySelector(s);
const thread = $('#thread');
const resultEl = $('#result');
const composer = $('#composer');
const free = $('#free');

const ORDER = ['situation', 'payment', 'receipt', 'contact', 'product'];
const blank = () => ({ crisis: '없음', situation: '모름', payment: '모름', receipt: '모름', contact: '모름', fakePost: '모름', product: '모름' });

const state = { facts: blank(), asked: new Set(), mode: null, busy: false, diag: null, hintMistransfer: false, ai: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const richText = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

// ───────── 대화 말풍선 ─────────
function bubble(who, html, extraClass = '') {
  const div = document.createElement('div');
  div.className = `msg ${who} ${extraClass}`.trim();
  div.innerHTML = who === 'bot' ? `<span class="who" aria-hidden="true">길잡이</span><div class="body">${html}</div>` : `<div class="body">${html}</div>`;
  thread.appendChild(div);
  div.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  return div;
}
const botSay = (html, cls) => bubble('bot', html, cls);
const userSay = (text) => bubble('user', esc(text));

function disablePending() {
  thread.querySelectorAll('.choices:not(.done) button, .understood:not(.done) select, .understood:not(.done) button').forEach((b) => { b.disabled = true; });
  thread.querySelectorAll('.choices:not(.done), .understood:not(.done)').forEach((g) => g.classList.add('done'));
}

function showCrisis() {
  state.facts.crisis = '있음';
  const b = $('#crisis-banner');
  if (b.hidden) {
    b.hidden = false;
    b.scrollIntoView({ block: 'start' });
  }
}

// ───────── 되묻기 ─────────
function ask(field) {
  const def = QUESTIONS[field];
  const q = field === 'situation' && state.hintMistransfer ? SITUATION_Q_MISTRANSFER : def.q;
  const msg = botSay(`<p>${esc(q)}</p><div class="choices" role="group" aria-label="${esc(FACT_LABELS[field])}"></div>`);
  const group = $('.choices', msg);
  for (const [value, label] of def.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (!state.mode) state.mode = 'button';
      group.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      btn.classList.add('picked');
      group.classList.add('done');
      userSay(label);
      state.facts[field] = value;
      state.asked.add(field);
      next();
    });
    group.appendChild(btn);
  }
  group.querySelector('button')?.focus({ preventScroll: true });
}

function isDone() {
  const f = state.facts;
  if (f.situation === '착오송금' || f.situation === '보이스피싱 등 다른 피해') return true;
  if (f.situation === '모름' && state.asked.has('situation')) return true;
  return pendingFields().length === 0;
}

function pendingFields() {
  const f = state.facts;
  if (f.receipt === '쿠폰·번호가 이미 사용됨·없음' && f.product === '모름') f.product = '비실물(기프티콘·모바일 상품권·티켓)';
  // 가짜 판매 글 정황은 버튼으로 진행할 때만 묻는다(〈표 5〉: 자유 입력이면 되묻지 않고 '모름'으로 진행)
  const order = state.mode === 'button' ? [...ORDER, 'fakePost'] : ORDER;
  return order.filter((k) => f[k] === '모름' && !state.asked.has(k));
}

function next() {
  if (state.facts.crisis === '있음') showCrisis();
  if (isDone()) return finish();
  ask(pendingFields()[0]);
}

// ───────── 자유 입력 ─────────
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = free.value.trim();
  if (!text || state.busy) return;
  free.value = '';
  if (!state.mode) state.mode = 'text';
  disablePending();
  userSay(text);
  if (hasCrisis(text)) showCrisis(); // 단어 목록으로 먼저 확인 — AI 응답을 기다리지 않는다
  if (/잘못\s?(보낸|송금|보냈)/.test(text)) state.hintMistransfer = true;

  state.busy = true;
  $('#send').disabled = true;
  const wait = botSay('<p class="typing">적어 주신 내용을 정리하고 있어요…</p>');
  try {
    const r = await fetch('/api/facts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await r.json();
    wait.remove();
    if (!r.ok) throw new Error(data.error || '정리하지 못했어요');
    state.ai = data;
    if (data.facts.crisis === '있음') showCrisis();
    showUnderstood(data);
  } catch (err) {
    wait.remove();
    botSay(`<p>${esc(err.message)}. 버튼으로 이어서 답해 주세요.</p>`);
    next();
  } finally {
    state.busy = false;
    $('#send').disabled = false;
  }
});

free.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); }
});

function aiBadge(data) {
  if (data.mode === 'live') return `<span class="badge live">실시간 · ${esc(data.provider)}가 정리</span>`;
  const why = (data.tried || []).map((t) => `${t.provider} ${t.reason}`).join(', ');
  return `<span class="badge demo">시연 값 · AI 연결 실패로 단어 규칙으로 정리</span>${why ? `<span class="badge-why">${esc(why)}</span>` : ''}`;
}

function showUnderstood(data) {
  const f = data.facts;
  const rows = Object.keys(QUESTIONS).filter((k) => k !== 'fakePost' || f.fakePost !== '모름').map((k) => {
    const opts = QUESTIONS[k].options.map(([v]) => `<option value="${esc(v)}" ${state.facts[k] !== '모름' && state.asked.has(k) ? (state.facts[k] === v ? 'selected' : '') : (f[k] === v ? 'selected' : '')}>${esc(v)}</option>`).join('');
    return `<label class="fact-row"><span>${esc(FACT_LABELS[k])}</span><select data-k="${k}">${opts}</select></label>`;
  }).join('');
  const tried = (data.tried || []).filter((t) => t.reason !== '건너뜀(시험용)');
  const fallbackNote = data.mode === 'live' && tried.length ? `<p class="small muted">앞 순서 AI 실패: ${esc(tried.map((t) => `${t.provider}(${t.reason})`).join(', '))}</p>` : '';
  const masked = data.masked?.length ? `<p class="small muted">${esc(data.masked.join('·'))}는 가리고 보냈어요.</p>` : '';
  const msg = botSay(`
    <p><strong>이렇게 이해했어요.</strong> 틀린 곳이 있으면 고쳐 주세요. '모름'인 것은 이어서 여쭤볼게요.</p>
    <div class="understood">
      <div class="facts-grid">${rows}</div>
      <div class="understood-foot">${aiBadge(data)}</div>
      ${fallbackNote}${masked}
      <button type="button" class="btn primary small-btn" data-go>이대로 진행</button>
    </div>`);
  const box = $('.understood', msg);
  $('[data-go]', msg).addEventListener('click', () => {
    box.querySelectorAll('select').forEach((s) => {
      const k = s.dataset.k;
      if (!state.asked.has(k) || state.facts[k] === '모름') state.facts[k] = s.value;
      if (s.value !== '모름') state.asked.add(k);
      s.disabled = true;
    });
    if (data.facts.crisis === '있음') state.facts.crisis = '있음';
    box.classList.add('done');
    $('[data-go]', msg).disabled = true;
    next();
  });
}

// ───────── 결과 ─────────
function finish() {
  state.diag = classify(state.facts);
  composer.hidden = true;
  $('.composer-note').hidden = true;
  botSay(`<p>정리가 끝났어요. 아래에서 결과를 확인하세요.</p>`);
  renderResult();
}

// 결과 이유를 피해자 말로 한 줄에. 규칙 번호는 화면에 내지 않고 정리표·상담원 복사 내용에만 남긴다.
const PLAIN_WHY = {
  1: '주문한 것과 전혀 다른 물건이 왔어요.',
  2: '판매 글 사진이 남의 사진이었어요.',
  3: '같은 판매자의 다른 피해 글이 있었어요.',
  4: '물건을 못 받았고, 판매자가 답이 없거나 차단했어요.',
  5: '물건을 못 받았고, 판매 글이나 계정이 사라졌어요.',
  6: '받은 쿠폰·번호가 이미 쓰였거나 없어요.',
  7: '물건은 왔지만 설명과 다르고, 판매자와 연락이 돼요.',
  8: '배송 중에 파손됐고, 판매자와 연락이 돼요.',
};
function plainWhy(diag) {
  if (diag.result === 'mistransfer') return '계좌번호나 금액을 잘못 입력해 보낸 경우예요.';
  if (diag.result === 'phishing') return '인증번호·비밀번호를 알려 줬거나 링크로 앱을 설치한 경우예요.';
  return PLAIN_WHY[diag.rule] || '답하신 내용이 사기 신호나 분쟁 기준 어느 쪽에도 딱 맞지 않아요.';
}

function factsChips() {
  return Object.keys(QUESTIONS).map((k) => `<li><span>${esc(FACT_LABELS[k])}</span>${esc(state.facts[k])}</li>`).join('');
}

function renderResult() {
  const { diag, facts } = state;
  const meta = RESULT_META[diag.result];
  const g = guidance(diag.result, facts);

  resultEl.innerHTML = `
    ${facts.crisis === '있음' ? `<div class="crisis-box" role="alert"><strong>먼저, 마음이 힘드시다면 ☎109</strong> 자살예방 상담전화가 24시간 이야기를 들어 드려요. 위급하면 ☎112·☎119.</div>` : ''}
    <div class="verdict tone-${meta.tone}">
      <div class="verdict-top">
        <p class="verdict-kicker">진단 결과</p>
        <button type="button" class="link-btn" data-restart>처음부터 다시</button>
      </div>
      <h2 class="verdict-title">${esc(meta.title)}</h2>
      <p class="verdict-why">${esc(plainWhy(diag))}</p>
      <p class="verdict-lead">${esc(g.lead)}</p>
      <details class="mini">
        <summary>내가 답한 내용 보기</summary>
        <ul class="fact-chips">${factsChips()}</ul>
      </details>
    </div>

    <section class="card">
      <h3>지금 할 일</h3>
      <ol class="steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${g.fixed ? '<p class="small muted">시간이 급한 안내라 정해 둔 문구로 드려요.</p>' : ''}
    </section>

    <section class="card">
      <h3>안내 기관</h3>
      <ul class="agencies">${g.agencies.map((a) => `
        <li>
          <p class="ag-name">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)} ↗</a>` : esc(a.name)}</p>
          <p class="ag-note">${esc(a.note)}</p>
          <p class="src">근거: ${esc(a.src)}</p>
        </li>`).join('')}</ul>
      <button type="button" class="btn ghost handoff-btn" data-handoff>상담원용 정리 내용 복사</button>
      <p class="small muted handoff-note">365센터 상담이나 카카오톡·누리집 상담 신청 때 붙여 넣으면 같은 질문을 다시 받지 않아요.</p>
    </section>

    ${diag.result === 'dispute' ? `
    <section class="card">
      <h3>판매자에게 보낼 요청 메시지 초안</h3>
      <p class="small muted">[ ] 안을 채워 보내세요. 정해 둔 양식이에요.</p>
      <textarea class="draft" id="draft" rows="8" readonly>${esc(disputeMessage(facts))}</textarea>
      <button type="button" class="btn ghost" data-copy="#draft">초안 복사</button>
    </section>` : ''}

    ${sheetSectionHtml()}

    <section class="card ask">
      <h3>더 궁금한 점 묻기</h3>
      <p class="small muted">안내 자료(기관 공식 누리집·법제처 생활법령 등)에 있는 내용으로만 답해요. 자료에 없으면 모른다고 하고 365센터를 알려 드려요.</p>
      <div class="ask-thread" id="ask-thread" aria-live="polite"></div>
      <form class="ask-form" id="ask-form" autocomplete="off">
        <label for="ask-q" class="sr-only">궁금한 점</label>
        <input id="ask-q" maxlength="500" placeholder="예) 경찰에 신고할 때 뭘 챙겨 가야 해요?" />
        <button class="btn primary" type="submit">묻기</button>
      </form>
    </section>

    <section class="card law-card" id="law-card" hidden>
      <details>
        <summary><span class="law-summary">관련 법령 보기</span> <span class="small muted">국가법령정보 실시간 조회</span></summary>
        <div id="law-list"></div>
      </details>
    </section>

    <p class="disclaimer">${esc(DISCLAIMER)}</p>
    <div class="result-actions">
      <button type="button" class="btn ghost" data-restart>처음부터 다시</button>
    </div>`;
  resultEl.hidden = false;
  resultEl.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  wireSheet();
  wireAsk();
  loadLaws(diag.result);
  resultEl.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($(b.dataset.copy).value, b)));
  resultEl.querySelectorAll('[data-restart]').forEach((b) => b.addEventListener('click', restart));
  resultEl.querySelectorAll('[data-handoff]').forEach((b) => b.addEventListener('click', (e) => copyText(summaryText(), e.currentTarget)));
}

// ───────── 증거 정리표 ─────────
function sheetSectionHtml() {
  const f = (id, label, ph = '') => `<label class="field"><span>${label}</span><input id="sf-${id}" data-sf="${id}" placeholder="${esc(ph)}" /></label>`;
  return `
    <section class="card sheet-card" id="sheet-card">
      <h3>증거 정리표</h3>
      <p class="small muted">아는 것만 적으세요. 비운 칸은 '모름'으로 남아요. 적은 내용은 이 화면에만 있고 서버로 보내지 않아요. 주민등록번호는 적지 마세요.</p>
      <div class="sheet-grid">
        <div class="sheet-form">
          <label class="field wide"><span>사건 타임라인 (한 줄에 하나씩)</span><textarea id="sf-timeline" data-sf="timeline" rows="3" placeholder="10/01 판매 글 확인 (OO 앱)&#10;10/02 14:10 150,000원 계좌이체&#10;10/05 연락 두절"></textarea></label>
          ${f('amount', '피해 금액', '예) 150,000원')}
          ${f('payCount', '송금 횟수', '예) 1')}
          ${f('app', '거래 앱', '예) OO 앱')}
          ${f('nick', '상대 닉네임')}
          ${f('pid', '상대 프로필 ID', '예) #ab12cd')}
          ${f('bank', '입금 은행')}
          ${f('account', '입금 계좌번호')}
          ${f('holder', '예금주')}
          ${f('phone', '상대 연락처')}
        </div>
        <div class="sheet-preview">
          <pre id="sheet-pre" tabindex="0" aria-label="증거 정리표 미리보기"></pre>
          <div class="sheet-actions">
            <button type="button" class="btn primary" id="btn-dl">정리표 내려받기(.txt)</button>
            <button type="button" class="btn ghost" id="btn-print">인쇄 · PDF로 저장</button>
            <button type="button" class="btn ghost" id="btn-copy-sheet">복사</button>
          </div>
        </div>
      </div>
    </section>`;
}

function sheetForm() {
  const o = {};
  resultEl.querySelectorAll('[data-sf]').forEach((el) => { o[el.dataset.sf] = el.value; });
  return o;
}

function wireSheet() {
  const pre = $('#sheet-pre');
  const render = () => { pre.textContent = buildSheet(state.diag, state.facts, sheetForm()); };
  render();
  resultEl.querySelectorAll('[data-sf]').forEach((el) => el.addEventListener('input', render));
  $('#btn-dl').addEventListener('click', () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    downloadText(pre.textContent, `증거정리표_${ymd}.txt`);
  });
  $('#btn-print').addEventListener('click', () => {
    document.body.classList.add('print-sheet');
    window.print();
    setTimeout(() => document.body.classList.remove('print-sheet'), 500);
  });
  $('#btn-copy-sheet').addEventListener('click', (e) => copyText(pre.textContent, e.currentTarget));
}

// ───────── 관련 법령 ─────────
const LAW_TOPICS = { fraud: ['fraud', 'stoppay', 'lawmaking'], dispute: ['dispute'], phishing: [], mistransfer: [], unclear: [] };

async function loadLaws(result) {
  const topics = LAW_TOPICS[result] || [];
  if (!topics.length) return;
  $('#law-card').hidden = false;
  const list = $('#law-list');
  list.innerHTML = topics.map((t) => `<div class="law" id="law-${t}"><p class="muted small">불러오는 중…</p></div>`).join('');
  await Promise.all(topics.map(async (t) => {
    const box = $(`#law-${t}`);
    try {
      const r = await fetch(`/api/law?topic=${t}`);
      const j = await r.json();
      box.innerHTML = lawHtml(j);
    } catch {
      box.innerHTML = '<p class="small muted">법령 정보를 불러오지 못했어요. 국가법령정보센터(law.go.kr)에서 확인하세요.</p>';
    }
  }));
}

function lawHtml(j) {
  const badge = j.mode === 'live'
    ? '<span class="badge live">실시간</span>'
    : `<span class="badge demo">시연 값</span><span class="badge-why">실시간 조회 실패: ${esc(j.reason)}${j.topic === 'lawmaking' ? '' : ' · 2026-11-19 조회 결과'}</span>`;
  const d = j.data;
  if (!d) return `<p class="law-head">${badge}</p><p class="small muted">${esc(j.why)}</p>`;
  if (j.topic === 'lawmaking') {
    return `<p class="law-head"><strong>진행 중인 입법예고</strong> ${badge}</p><p class="small muted">${esc(j.why)}</p>
      <ul class="plain">${d.items.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul>
      <p class="small"><a href="${esc(d.link)}" target="_blank" rel="noopener">국민참여입법센터 ↗</a></p>`;
  }
  const a = d.article || {};
  const proviso = (a.text || '').match(/다만, 재화의 공급[^.]*\./);
  return `
    <p class="law-head"><strong>${esc(d.name)} ${esc(a.title || '')}</strong> ${badge}</p>
    <p class="small muted">${esc(j.why)}</p>
    ${proviso ? `<blockquote class="proviso">${esc(proviso[0])}</blockquote>` : ''}
    <details><summary>조문 전체 보기</summary><pre class="law-text">${esc(a.text || '')}</pre></details>
    <p class="small muted">현행 시행일 ${esc(d.effective)} · 공포일 ${esc(d.promulgated)} · ${esc(d.revision)} · <a href="${esc(d.link)}" target="_blank" rel="noopener">국가법령정보센터 ↗</a></p>
    ${d.history?.length ? `<details><summary>이 조문의 변경 이력</summary><ul class="plain small">${d.history.map((h) => `<li>${esc(h.changed)} ${esc(h.reason)} (${esc(h.revision)})</li>`).join('')}</ul></details>` : ''}
    ${d.oldNew?.rows?.length ? `<details><summary>최근 개정 신구법 비교 (시행 ${esc(d.oldNew.oldInfo.effective)} → ${esc(d.oldNew.newInfo.effective)})</summary>
      <div class="table-wrap"><table class="oldnew"><thead><tr><th scope="col">개정 전</th><th scope="col">개정 후</th></tr></thead><tbody>${d.oldNew.rows.map((r) => `<tr><td>${esc(r.old)}</td><td>${esc(r.new)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
}

// ───────── 더 궁금한 점 묻기 ─────────
function wireAsk() {
  const form = $('#ask-form');
  const input = $('#ask-q');
  const box = $('#ask-thread');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    const qEl = document.createElement('p');
    qEl.className = 'ask-q';
    qEl.textContent = q;
    box.appendChild(qEl);
    if (hasCrisis(q)) showCrisis();
    const aEl = document.createElement('div');
    aEl.className = 'ask-a';
    aEl.innerHTML = '<p class="typing">안내 자료에서 찾고 있어요…</p>';
    box.appendChild(aEl);
    form.querySelector('button').disabled = true;
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, result: state.diag.result }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '답을 만들지 못했어요');
      const tag = j.kind === 'live' ? `<span class="badge live">실시간 · ${esc(j.provider)}가 답함</span>`
        : j.kind === 'fixed' ? '<span class="badge fixed">정해 둔 안내</span>'
        : j.kind === 'demo' ? `<span class="badge demo">시연 값 · AI 연결 실패</span><span class="badge-why">${esc((j.tried || []).map((t) => `${t.provider} ${t.reason}`).join(', '))}</span>`
        : '<span class="badge fixed">자료 없음</span>';
      aEl.innerHTML = `<div class="ask-body">${richText(j.answer)}</div>
        ${j.sources?.length ? `<ul class="ask-src">${j.sources.map((s) => `<li>근거: ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</li>`).join('')}</ul>` : ''}
        <p class="ask-meta">${tag}</p>`;
    } catch (err) {
      aEl.innerHTML = `<p>${esc(err.message)}. 365센터 ☎${CENTER.phone} 로 문의해 주세요.</p>`;
    } finally {
      form.querySelector('button').disabled = false;
    }
  });
}

// ───────── 상담원 연결 · 복사 ─────────
function summaryText() {
  const f = state.facts;
  const lines = ['[중고거래 피해 대응 길잡이 정리 내용]', ...Object.keys(QUESTIONS).map((k) => `- ${FACT_LABELS[k]}: ${f[k]}`)];
  if (f.crisis === '있음') lines.push('- 위기 표현: 있음 (109 안내함)');
  if (state.diag) {
    const m = RESULT_META[state.diag.result];
    lines.push(`- 길잡이 결과: ${m.title} (${state.diag.rule && state.diag.rule !== '-' ? `규칙 ${state.diag.rule}: ` : ''}${state.diag.why})`);
  } else lines.push('- 길잡이 결과: 아직 진단 중');
  lines.push('※ 법적 판단이 아닌 안내입니다.');
  return lines.join('\n');
}

async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = ok ? '복사했어요' : '복사하지 못했어요';
    setTimeout(() => { btn.textContent = old; }, 1600);
  }
  return ok;
}

$('#btn-handoff').addEventListener('click', async (e) => {
  const ok = await copyText(summaryText(), e.currentTarget);
  $('#handoff-msg').textContent = ok ? `복사했어요. ☎${CENTER.phone} 상담이나 카카오톡·누리집 상담 신청 때 붙여 넣으세요.` : '';
});

// ───────── 시작 · 다시 ─────────
function start() {
  botSay(`<p>안녕하세요. 중고거래에서 생긴 일을 함께 정리해 볼게요.</p><p>버튼으로 답하거나, 아래 칸에 있었던 일을 그대로 적어 주세요. 사기인지 분쟁인지 가려서 어디로 가야 할지 알려 드릴게요.</p>`);
  ask('situation');
}

function restart() {
  Object.assign(state, { facts: blank(), asked: new Set(), mode: null, busy: false, diag: null, hintMistransfer: false, ai: null });
  thread.innerHTML = '';
  resultEl.hidden = true;
  resultEl.innerHTML = '';
  composer.hidden = false;
  $('.composer-note').hidden = false;
  $('#crisis-banner').hidden = true;
  window.scrollTo({ top: 0 });
  start();
}

start();
