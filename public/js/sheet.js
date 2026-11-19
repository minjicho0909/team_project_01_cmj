// 증거 정리표 — 결정사항 S9: 화면에 고정된 양식. 6개 칸과 순서는 어떤 경우에도 같고, 모르는 칸은 '모름'으로 남긴다.
// 이용자가 적은 값은 이 브라우저 안에서만 쓰고 서버로 보내지 않는다.

import { RESULT_META } from './rules.js';
import { sheetParts } from './content.js';

const LINE = '==================================================';
const THIN = '--------------------------------------------------';
const v = (s) => (String(s || '').trim() ? String(s).trim() : '모름');

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * @param diag  { result, rule, why }
 * @param facts 사실 항목
 * @param form  { timeline, amount, payCount, app, nick, pid, bank, account, holder, phone }
 */
export function buildSheet(diag, facts, form = {}) {
  const meta = RESULT_META[diag.result];
  const parts = sheetParts(diag.result, facts);
  const ruleText = diag.rule && diag.rule !== '-' ? `규칙 ${diag.rule}: ${diag.why}` : diag.why;
  const timeline = String(form.timeline || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const circled = ['①', '②', '③', '④', '⑤', '⑥'];
  const sources = [...new Set(parts.checklist.map(([, src]) => src))];

  return [
    LINE,
    '중고거래 피해 제출용 증거 정리표',
    LINE,
    `작성일시 : ${stamp()} (중고거래 피해 대응 길잡이 · 시제품)`,
    '',
    `1. 진단 결과 : ${meta.title} (${ruleText})`,
    '',
    '2. 사건 타임라인',
    ...(timeline.length ? timeline.map((t) => `  - ${t}`) : ['  - 모름']),
    '',
    `3. 피해 금액 : ${v(form.amount)}${form.amount ? ` (${facts.payment && facts.payment !== '모름' ? facts.payment : '송금 방법 모름'}${form.payCount ? ` ${form.payCount}회` : ''})` : ''}`,
    '',
    '4. 상대방 정보',
    `  - 거래 앱 / 닉네임 / 프로필 ID : ${v(form.app)} / ${v(form.nick)} / ${v(form.pid)}`,
    `  - 입금 계좌 : ${form.bank || form.account || form.holder ? `${v(form.bank)} ${v(form.account)} (예금주 ${v(form.holder)})` : '모름'}`,
    `  - 연락처 : ${v(form.phone)}`,
    '',
    '5. 필수 첨부 증거 체크리스트',
    ...parts.checklist.map(([item]) => `  [ ] ${item}`),
    '',
    '6. 우선 제출 기관 (순서)',
    ...parts.order.map((o, i) => `  ${circled[i] || '-'} ${o}`),
    THIN,
    '※ 위 내용은 피해자가 확인·수정한 것입니다. 원본 캡처 파일을 함께 내세요.',
    '※ 본 정리표는 안내용이며 법적 효력을 갖지 않습니다.',
    `※ 체크리스트 근거: ${sources.join(' / ')}`,
    LINE,
  ].join('\n');
}

export function downloadText(text, name) {
  const blob = new Blob(['﻿' + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
