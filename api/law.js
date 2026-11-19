// GET /api/law?topic=fraud|dispute|stoppay|lawmaking
// 최신 법령 정보를 국가법령정보 공동활용(LAW_OC)·국민참여입법센터(LAWMAKING_OC)에서 실시간으로 부른다.
// 실패하면 이유(키 비어 있음 · 승인 안 됨 · 시간 초과 · 오류)와 「시연 값」(2026-11-19 실시간 조회 결과를 저장한 것)을 함께 돌려준다.
// OC 값은 응답에 절대 넣지 않는다.

import { getKey, fetchWithTimeout, sendJson } from './_lib/env.js';
import LAW_DEMO from './_lib/law-demo.js';

const DRF = 'https://www.law.go.kr/DRF/';
const SPECIAL = '전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법';

const TOPICS = {
  fraud: { law: '형법', jo: '034700', why: '사기 의심 — 형법상 사기죄는 경찰이 수사합니다' },
  dispute: { law: '민법', jo: '039000', why: '거래 분쟁 — 약속을 지키지 않은 문제(채무불이행)는 합의·분쟁조정으로 풉니다' },
  stoppay: { law: SPECIAL, jo: '000200', history: true, oldNew: true, why: '지급정지 — 이 법은 "재화의 공급 등을 가장한 행위"를 빼므로 중고거래 사기는 은행마다 판단이 다릅니다' },
  lawmaking: { why: '진행 중인 입법예고 — 안내 문구를 정기적으로 점검하기 위해 봅니다' },
};

// 국민참여입법센터 입법예고 API 주소. ⚠ 공식 명세를 아직 확인하지 못했다(출처 미확인).
// LAWMAKING_OC 에 값을 넣은 뒤 실제 응답을 보고 이 주소와 아래 파싱을 맞춘다.
const LAWMAKING_URL = 'https://opinion.lawmaking.go.kr/rest/ogLmPp';

const memo = new Map(); // topic → { at, data } (1시간)
function demo(topic) {
  return LAW_DEMO[topic] || null;
}

class LawError extends Error { constructor(reason) { super(reason); this.reason = reason; } }

const strip = (s) => String(s || '').replace(/<\/?P>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+\n/g, '\n').trim();
const ymd = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s || '');

async function drf(pathName, params) {
  const OC = getKey('LAW_OC');
  if (!OC) throw new LawError('키 비어 있음');
  const sp = new URLSearchParams({ OC, type: 'JSON', ...params });
  const r = await fetchWithTimeout(`${DRF}${pathName}?${sp}`, {}, 12000).catch((e) => {
    throw new LawError(e.code === 'TIMEOUT' ? '시간 초과' : '연결 오류');
  });
  const text = await r.text();
  if (!r.ok) throw new LawError(`오류 ${r.status}`);
  let j;
  try { j = JSON.parse(text); } catch { throw new LawError(/검증에\s*실패/.test(text) ? '승인 안 됨(OC 또는 서버 주소 미등록)' : '응답 형식 오류'); }
  // 예: { "result": "사용자 정보 검증에 실패하였습니다.", "msg": "...서버장비의 IP주소 및 도메인주소를 등록해 주세요." }
  if (typeof j.result === 'string' && /검증에\s*실패/.test(j.result)) throw new LawError('승인 안 됨(OC 또는 서버 주소 미등록)');
  return j;
}

function articleText(units, jo) {
  const no = String(parseInt(jo.slice(0, 4), 10));
  const art = (units || []).find((u) => u.조문번호 === no && u.조문여부 === '조문') || (units || []).find((u) => u.조문번호 === no);
  if (!art) return null;
  const lines = [strip(art.조문내용)];
  const asArr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  for (const h of asArr(art.항)) {
    if (h.항내용) lines.push(strip(h.항내용));
    for (const ho of asArr(h.호)) {
      lines.push('  ' + strip(ho.호내용));
      for (const mok of asArr(ho.목)) lines.push('    ' + strip(Array.isArray(mok.목내용) ? mok.목내용.join(' ') : mok.목내용));
    }
  }
  const head = strip(art.조문내용);
  return { title: (head.match(/^제\d+조(?:의\d+)?\([^)]*\)/) || [head.slice(0, 30)])[0], text: lines.filter(Boolean).join('\n'), effective: ymd(art.조문시행일자) };
}

async function lawTopic(t) {
  const s = await drf('lawSearch.do', { target: 'law', query: t.law, display: '50' });
  const list = s?.LawSearch?.law ? [].concat(s.LawSearch.law) : [];
  const hit = list.find((x) => x.법령명한글 === t.law && x.현행연혁코드 === '현행') || list.find((x) => x.법령명한글 === t.law);
  if (!hit) throw new LawError('법령을 찾지 못함');
  const body = await drf('lawService.do', { target: 'law', MST: hit.법령일련번호, JO: t.jo });
  const units = body?.법령?.조문?.조문단위 ? [].concat(body.법령.조문.조문단위) : [];
  const out = {
    name: t.law,
    effective: ymd(hit.시행일자),
    promulgated: ymd(hit.공포일자),
    revision: hit.제개정구분명,
    article: articleText(units, t.jo),
    link: `https://www.law.go.kr/법령/${encodeURIComponent(t.law)}`,
  };
  if (t.history) {
    try {
      const h = await drf('lawService.do', { target: 'lsJoHstInf', ID: hit.법령ID, JO: t.jo });
      const rows = h?.LawService?.law ? [].concat(h.LawService.law) : [];
      out.history = rows.map((r) => ({
        changed: ymd(r.조문정보?.조문변경일),
        reason: r.조문정보?.변경사유 || '',
        revision: r.법령정보?.제개정구분명 || '',
        effective: ymd(r.법령정보?.시행일자),
      })).sort((a, b) => (a.changed < b.changed ? 1 : -1)).slice(0, 6);
    } catch (e) { out.historyError = e.reason || '오류'; }
  }
  if (t.oldNew) {
    try {
      const o = await drf('lawService.do', { target: 'oldAndNew', MST: hit.법령일련번호 });
      const svc = o?.OldAndNewService || {};
      const olds = svc.구조문목록?.조문 ? [].concat(svc.구조문목록.조문) : [];
      const news = svc.신조문목록?.조문 ? [].concat(svc.신조문목록.조문) : [];
      out.oldNew = {
        oldInfo: { effective: ymd(svc.구조문_기본정보?.시행일자), revision: svc.구조문_기본정보?.제개정구분명 },
        newInfo: { effective: ymd(svc.신조문_기본정보?.시행일자), revision: svc.신조문_기본정보?.제개정구분명 },
        rows: news.map((n, i) => ({ old: strip(olds[i]?.content), new: strip(n.content) })).slice(0, 4),
      };
    } catch (e) { out.oldNewError = e.reason || '오류'; }
  }
  return out;
}

async function lawmakingTopic() {
  const OC = getKey('LAWMAKING_OC');
  if (!OC) throw new LawError('키 비어 있음');
  const sp = new URLSearchParams({ OC, lsNm: '전기통신금융사기' });
  const r = await fetchWithTimeout(`${LAWMAKING_URL}?${sp}`, {}, 12000).catch((e) => {
    throw new LawError(e.code === 'TIMEOUT' ? '시간 초과' : '연결 오류');
  });
  const text = await r.text();
  if (!r.ok) throw new LawError(r.status === 401 || r.status === 403 ? '승인 안 됨' : `오류 ${r.status}`);
  // 응답 모양 미확인: 제목 후보만 뽑는다
  const titles = [...text.matchAll(/<(?:lsNm|법령명|title)>([^<]+)</g)].map((m) => m[1].trim()).slice(0, 5);
  if (!titles.length) throw new LawError('응답 형식 확인 필요(API 명세 미확인)');
  return { items: titles.map((t) => ({ title: t })), link: 'https://opinion.lawmaking.go.kr' };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const topic = url.searchParams.get('topic');
  const t = TOPICS[topic];
  if (!t) return sendJson(res, 400, { error: 'topic 은 fraud · dispute · stoppay · lawmaking 중 하나' });

  const m = memo.get(topic);
  if (m && Date.now() - m.at < 3600_000) return sendJson(res, 200, m.data);

  try {
    const data = topic === 'lawmaking' ? await lawmakingTopic() : await lawTopic(t);
    const payload = { topic, mode: 'live', why: t.why, data, checkedAt: new Date().toISOString() };
    memo.set(topic, { at: Date.now(), data: payload });
    sendJson(res, 200, payload);
  } catch (e) {
    sendJson(res, 200, { topic, mode: 'demo', reason: e.reason || '오류', why: t.why, data: demo(topic) });
  }
}

// 시연 값 파일을 만들 때만 쓴다(scripts 에서 호출)
export { lawTopic, TOPICS };
