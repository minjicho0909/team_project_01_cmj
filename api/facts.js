// POST /api/facts  { text } → 자유롭게 쓴 문장을 〈표 5〉 사실 항목으로 정리
// AI 는 값 고르기만 한다. 분류(규칙표)는 화면의 rules.js 가 한다.

import { callAI, parseJsonLoose } from './_lib/ai.js';
import { FACT_SCHEMA, FACT_SYSTEM, sanitizeFacts } from './_lib/facts.js';
import { maskPersonal } from './_lib/mask.js';
import { readJsonBody, sendJson } from './_lib/env.js';
import { hasCrisis, hasPhishing } from '../public/js/rules.js';

// AI 가 모두 실패했을 때 쓰는 「시연 값」: 단어 규칙으로만 정리한다(정확도 낮음, 화면에 그렇게 표시)
function keywordFacts(text) {
  const t = text.replace(/\s+/g, '');
  const has = (...ws) => ws.some((w) => t.includes(w.replace(/\s/g, '')));
  return {
    crisis: hasCrisis(text) ? '있음' : '없음',
    situation: hasPhishing(text) ? '보이스피싱 등 다른 피해'
      : has('잘못입력', '계좌번호를잘못', '금액을잘못', '번호를잘못') ? '착오송금'
      : has('잘못보낸', '잘못송금') ? '모름'
      : has('중고', '판매자', '구매', '샀', '사기', '거래', '입금', '송금', '기프티콘', '쿠폰', '티켓') ? '중고거래 피해' : '모름',
    payment: has('안전결제', '번개페이', '당근페이') ? '플랫폼 안전결제' : has('계좌', '이체', '입금', '송금') ? '계좌이체' : has('직거래', '현장', '만나서') ? '직거래 현장 결제' : '모름',
    receipt: has('이미사용', '사용된쿠폰', '사용완료', '번호가없') ? '쿠폰·번호가 이미 사용됨·없음'
      : has('다른물건', '벽돌', '엉뚱한') ? '전혀 다른 물건이 옴'
      : has('파손', '깨져', '부서져') ? '배송 중 파손'
      : has('설명과다', '하자', '고장', '상태가다') ? '설명과 상태가 다름'
      : has('배송중이라', '보냈다고') ? '배송 중이라고 함'
      : has('안옴', '안와', '못받', '안왔', '오지않', '안보내') ? '못 받음' : '모름',
    contact: has('글삭제', '글이지워', '글도지워', '계정삭제', '탈퇴', '글이사라') ? '판매 글·계정 사라짐'
      : has('차단', '답이없', '답없', '연락두절', '잠수', '읽씹', '연락안', '연락이안') ? '답 없음·차단'
      : has('연락은되', '연락됨', '답장은') ? '연락됨' : '모름',
    fakePost: has('남의사진', '도용') ? '남의 사진이었음' : has('다른피해', '피해글') ? '다른 피해 글을 봄' : '모름',
    product: has('기프티콘', '쿠폰', '상품권', '티켓', '모바일교환권') ? '비실물(기프티콘·모바일 상품권·티켓)' : has('이어폰', '폰', '노트북', '옷', '가방', '물건', '택배') ? '실물' : '모름',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST 만 받습니다' });
  const { text } = await readJsonBody(req);
  const input = String(text || '').slice(0, 1000).trim();
  if (!input) return sendJson(res, 400, { error: '내용이 비어 있습니다' });

  const crisisByWord = hasCrisis(input);
  const { text: masked, masked: maskedKinds } = maskPersonal(input);
  const skip = (process.env.AI_SKIP || '').split(',').map((s) => s.trim()).filter(Boolean);

  const ai = await callAI({ system: FACT_SYSTEM, user: masked, schema: FACT_SCHEMA, maxTokens: 400, skip });
  let facts;
  let dropped = [];
  let mode = 'live';
  if (ai.provider) {
    const parsed = parseJsonLoose(ai.text);
    if (parsed) ({ facts, dropped } = sanitizeFacts(parsed));
  }
  if (!facts) {
    mode = 'demo';
    facts = keywordFacts(input);
  }
  // 위기 표현: 단어 목록과 AI 판단 중 하나라도 걸리면 '있음'(〈표 5〉 주)
  if (crisisByWord) facts.crisis = '있음';

  sendJson(res, 200, {
    mode, // live = AI 가 정리, demo = AI 연결 실패로 단어 규칙(시연 값)
    facts,
    dropped, // 목록 밖 값이 와서 버린 항목(→ '모름' 으로 두고 버튼으로 되묻는다)
    provider: ai.provider,
    model: ai.model,
    tried: ai.tried,
    masked: maskedKinds,
  });
}
