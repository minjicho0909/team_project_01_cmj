// POST /api/ask  { question, result } → 「더 궁금한 점 묻기」
// CLAUDE.md 「AI 답변 규칙」 + 결정사항 S1·S2·S4·S6·S7·S8:
//  - 답변참고문서/청킹 조각으로만 답한다. 없으면 모른다고 하고 365센터를 안내한다
//  - 근거 문서 이름을 붙인다(「문서 이름 · 소제목」)
//  - 위기 표현 → 검색·AI 없이 109 고정 문구 / 보이스피싱 → 112 고정 문구
//  - 안내 기관은 기획서 목록만, 환급·배상 금액은 말하지 않고 분쟁조정위원회로

import { callAI } from './_lib/ai.js';
import { searchChunks } from './_lib/chunks.js';
import { maskPersonal } from './_lib/mask.js';
import { readJsonBody, sendJson } from './_lib/env.js';
import { hasCrisis, hasPhishing } from '../public/js/rules.js';

const CENTER = '온라인피해 365센터(☎142-235, 평일 09:00~12:00·13:00~18:00 / 카카오톡·누리집 신청은 24시간)';

const FIXED = {
  crisis: '지금 많이 힘드시다면 혼자 견디지 마세요. 자살예방 상담전화 ☎109 에서 24시간 이야기를 들어 드립니다. 위급하면 ☎112·☎119 로 바로 연락하세요. 통화 뒤에 원하시면 피해 상황 정리를 이어서 도와드릴게요.',
  phishing: '보이스피싱이 의심됩니다. 지금 바로 ☎112 에 신고하고, 돈을 보낸 은행(송금 은행) 콜센터에 전화해 지급정지를 요청하세요. 이 안내는 시간이 급해 고정 문구로 드립니다.',
  money: '환급·배상 금액이나 비율은 길잡이가 안내하지 않습니다. 금액은 판매자와의 합의나 전자문서·전자거래분쟁조정위원회의 조정으로 정해집니다. 분쟁조정위원회에 문의하세요.',
};

const SYSTEM = `너는 방송미디어통신위원회 온라인피해 365센터의 「중고거래 피해 대응 길잡이」다.
반드시 아래 [근거 조각]에 적힌 내용으로만 한국어로 답한다. 조각에 없는 내용은 지어내지 않는다.

규칙:
1. 조각에 답이 없으면 "제가 가진 안내 자료에는 그 내용이 없습니다."라고 쓰고 ${CENTER} 로 문의하라고 안내한다.
2. 안내하는 기관은 다음만 쓴다: 경찰청(사이버범죄 신고시스템 ECRM·경찰서), 거래 플랫폼, 전자문서·전자거래분쟁조정위원회, 대한법률구조공단(☎132), 온라인피해 365센터, 범위 밖 상황의 예금보험공사·109·112. 소비자원·1372·소비자24·더치트·사이버캅은 조각에 있어도 "참고로"라고 붙여서만 짧게 언급한다.
3. 환급·배상 금액이나 비율을 말하지 않는다. 금액 질문은 전자문서·전자거래분쟁조정위원회로 안내한다.
4. 사기 여부·자격·처분을 단정하지 않는다. "~일 수 있어요", "~에 확인하세요"처럼 안내로 말한다.
5. 공식 자료끼리 다르면 둘 다 말하고 "기관에 확인하세요"라고 한다.
6. 돈·비밀번호·인증번호·주민등록번호를 묻지 않는다.
7. 쉬운 말로 4~6문장 이내. 답 끝에 출처는 쓰지 않는다(화면이 따로 붙인다).`;

const MONEY_RE = /얼마|몇\s?%|퍼센트|비율|배상\s?금액|환급\s?금액|돌려받을\s?수\s?있는\s?금액|보상\s?금액/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST 만 받습니다' });
  const { question, result } = await readJsonBody(req);
  const q = String(question || '').slice(0, 500).trim();
  if (!q) return sendJson(res, 400, { error: '질문이 비어 있습니다' });
  if (!result) return sendJson(res, 400, { error: '진단을 먼저 마쳐 주세요' }); // S8: 진단 뒤에만

  if (hasCrisis(q)) return sendJson(res, 200, { kind: 'fixed', fixed: 'crisis', answer: FIXED.crisis, sources: [], provider: null });
  if (hasPhishing(q)) return sendJson(res, 200, { kind: 'fixed', fixed: 'phishing', answer: FIXED.phishing, sources: [], provider: null });
  if (MONEY_RE.test(q)) {
    const sources = searchChunks('분쟁조정 신청 방법 조정위원회', 'dispute', 2).map(({ label, url }) => ({ label, url }));
    return sendJson(res, 200, { kind: 'fixed', fixed: 'money', answer: FIXED.money, sources, provider: null });
  }

  const hits = searchChunks(q, result, 4);
  if (!hits.length) {
    return sendJson(res, 200, { kind: 'none', answer: `제가 가진 안내 자료에는 그 내용이 없습니다. ${CENTER} 로 문의해 주세요.`, sources: [], provider: null });
  }

  const { text: maskedQ } = maskPersonal(q);
  const context = hits.map((h, i) => `[근거 ${i + 1}] ${h.label}\n${h.body}`).join('\n\n');
  const skip = (process.env.AI_SKIP || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ai = await callAI({
    system: SYSTEM,
    user: `[진단 결과] ${result}\n\n[근거 조각]\n${context}\n\n[이용자 질문]\n${maskedQ}`,
    maxTokens: 900,
    skip,
  });

  const sources = hits.map(({ label, url }) => ({ label, url }));
  if (!ai.provider) {
    // AI 가 모두 실패 → 「시연 값」: 가장 가까운 조각 본문을 그대로 보여 준다
    return sendJson(res, 200, {
      kind: 'demo',
      answer: `AI 연결에 실패해 가장 관련 있는 안내 자료를 그대로 보여 드려요.\n\n${hits[0].body}`,
      sources: sources.slice(0, 1),
      provider: null,
      tried: ai.tried,
    });
  }
  sendJson(res, 200, { kind: 'live', answer: ai.text.trim(), sources, provider: ai.provider, model: ai.model, tried: ai.tried });
}
