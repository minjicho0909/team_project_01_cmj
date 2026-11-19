// 판단 규칙 — 화면과 서버(api/ask.js)가 같은 파일을 쓴다. AI 없이 코드로만 판단한다.
// 기획서 〈표 7〉 분류 규칙표, 결정사항 S1(위기 → 109 고정 문구), S2(보이스피싱 → 112 고정 문구)

// 위기 단어 목록. "위기 놓침 0건"이 필수 조건이라 넓게 잡는다(조금 과하게 걸려도 109 안내는 해가 없다).
export const CRISIS_WORDS = [
  '죽고 싶', '죽고싶', '죽고만 싶', '죽어버리', '죽어 버리', '죽을래', '죽을 것 같', '죽을거같', '죽고 말', '죽겠',
  '자살', '자해', '살기 싫', '살기싫', '살고 싶지 않', '살고싶지않', '사라지고 싶', '사라지고싶', '끝내고 싶', '끝내고싶',
  '극단적', '목숨', '뛰어내리', '유서', '삶을 포기', '인생 끝', '다 끝났', '없어지고 싶', '손목을 긋', '손목 긋',
];

export function hasCrisis(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const compact = t.replace(/\s/g, '');
  return CRISIS_WORDS.some((w) => t.includes(w) || compact.includes(w.replace(/\s/g, '')));
}

// 보이스피싱 신호(기획서 〈표 2〉: 인증번호·비밀번호를 알려 줬거나 링크를 눌러 앱을 설치함)
export const PHISHING_WORDS = ['인증번호', '비밀번호를 알려', '비번 알려', 'otp', '원격', '앱을 설치', '앱 설치', '링크를 눌', '링크 눌', '검찰', '금감원 직원', '수사관'];

export function hasPhishing(text) {
  const t = String(text || '').toLowerCase();
  return PHISHING_WORDS.some((w) => t.includes(w));
}

// 〈표 5〉 사실 항목 이름
export const FACT_LABELS = {
  crisis: '위기 표현', situation: '상황 구분', payment: '송금 방법', receipt: '수령 상태',
  contact: '연락 상태', fakePost: '가짜 판매 글 정황', product: '상품 종류',
};

// 결과 종류 → 색(기획서 Ⅵ-3: 사기 의심 빨강, 거래 분쟁 파랑, 범위 밖 초록, 판단 어려움 회색)
export const RESULT_META = {
  fraud: { title: '사기 의심', tone: 'red' },
  dispute: { title: '거래 분쟁', tone: 'blue' },
  mistransfer: { title: '범위 밖 · 착오송금', tone: 'green' },
  phishing: { title: '범위 밖 · 보이스피싱', tone: 'green' },
  unclear: { title: '판단 어려움', tone: 'gray' },
};

// 〈표 7〉 위에서부터 대 보고 처음 맞는 줄의 결과를 낸다. ANY = 상관없음
const ANY = '*';
export const RULE_TABLE = [
  { no: 1, receipt: '전혀 다른 물건이 옴', contact: ANY, fakePost: ANY, result: 'fraud', why: '전혀 다른 물건이 옴' },
  { no: 2, receipt: ANY, contact: ANY, fakePost: '남의 사진이었음', result: 'fraud', why: '판매 글 사진이 남의 사진이었음' },
  { no: 3, receipt: ANY, contact: ANY, fakePost: '다른 피해 글을 봄', result: 'fraud', why: '같은 판매자의 다른 피해 글을 봄' },
  { no: 4, receipt: '못 받음', contact: '답 없음·차단', fakePost: ANY, result: 'fraud', why: '물건을 못 받았고 판매자가 답이 없거나 차단함' },
  { no: 5, receipt: '못 받음', contact: '판매 글·계정 사라짐', fakePost: ANY, result: 'fraud', why: '물건을 못 받았고 판매 글·계정이 사라짐' },
  { no: 6, receipt: '쿠폰·번호가 이미 사용됨·없음', contact: ANY, fakePost: ANY, result: 'fraud', why: '받은 쿠폰·번호가 이미 사용됐거나 없음' },
  { no: 7, receipt: '설명과 상태가 다름', contact: '연락됨', fakePost: ANY, result: 'dispute', why: '물건이 설명과 다르고 판매자와 연락됨' },
  { no: 8, receipt: '배송 중 파손', contact: '연락됨', fakePost: ANY, result: 'dispute', why: '배송 중 파손됐고 판매자와 연락됨' },
];

const match = (cell, v) => cell === ANY || cell === v;

/**
 * facts → { result, rule, why }
 * 순서: 범위 밖(착오송금·보이스피싱) → 상황 '모름' → 〈표 7〉 → 그 밖의 모든 경우(판단 어려움)
 * 위기 표현은 결과와 따로 crisis 로 돌려주어, 화면이 어떤 결과보다 먼저 109 상자를 띄운다.
 */
export function classify(facts) {
  const crisis = facts.crisis === '있음';
  if (facts.situation === '착오송금') return { result: 'mistransfer', rule: null, why: '계좌번호나 금액을 잘못 입력해 송금함', crisis };
  if (facts.situation === '보이스피싱 등 다른 피해') return { result: 'phishing', rule: null, why: '인증번호·비밀번호 제공, 링크로 앱 설치 등 보이스피싱 신호', crisis };
  if (facts.situation !== '중고거래 피해') return { result: 'unclear', rule: '-', why: '어떤 일인지 분명하지 않음', crisis };
  for (const r of RULE_TABLE) {
    if (match(r.receipt, facts.receipt) && match(r.contact, facts.contact) && match(r.fakePost, facts.fakePost)) {
      return { result: r.result, rule: r.no, why: r.why, crisis };
    }
  }
  return { result: 'unclear', rule: '-', why: '규칙표의 어느 줄에도 들어가지 않음(그 밖의 모든 경우)', crisis };
}

// 분류 전에 되물을 항목 순서(기획서 〈표 5〉 '모름'이면 되묻기). 가짜 판매 글 정황은 AI 입력에서는 되묻지 않는다.
export const ASK_ORDER = ['situation', 'payment', 'receipt', 'contact', 'product'];

export function missingFields(facts, { includeFakePost = false } = {}) {
  if (facts.situation === '착오송금' || facts.situation === '보이스피싱 등 다른 피해') return [];
  const order = includeFakePost ? [...ASK_ORDER, 'fakePost'] : ASK_ORDER;
  return order.filter((k) => !facts[k] || facts[k] === '모름');
}
