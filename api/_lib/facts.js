// 기획서 〈표 5〉 생성형 AI가 채우는 사실 항목. 값은 이 목록에서만 고를 수 있고, 목록 밖이면 '모름'.
// (상품 종류는 기획서 수정안 R2 반영: 비실물 = 기프티콘·모바일 상품권·티켓)

export const FACT_FIELDS = {
  crisis: { label: '위기 표현', values: ['있음', '없음'] },
  situation: { label: '상황 구분', values: ['중고거래 피해', '착오송금', '보이스피싱 등 다른 피해', '모름'] },
  payment: { label: '송금 방법', values: ['계좌이체', '플랫폼 안전결제', '직거래 현장 결제', '모름'] },
  receipt: { label: '수령 상태', values: ['못 받음', '배송 중이라고 함', '설명과 상태가 다름', '전혀 다른 물건이 옴', '배송 중 파손', '쿠폰·번호가 이미 사용됨·없음', '모름'] },
  contact: { label: '연락 상태', values: ['연락됨', '답 없음·차단', '판매 글·계정 사라짐', '모름'] },
  fakePost: { label: '가짜 판매 글 정황', values: ['남의 사진이었음', '다른 피해 글을 봄', '없음', '모름'] },
  product: { label: '상품 종류', values: ['실물', '비실물(기프티콘·모바일 상품권·티켓)', '모름'] },
};

export const FACT_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(Object.entries(FACT_FIELDS).map(([k, f]) => [k, { type: 'string', enum: f.values }])),
  required: Object.keys(FACT_FIELDS),
  additionalProperties: false,
};

export const FACT_SYSTEM = `너는 온라인피해 365센터 「중고거래 피해 대응 길잡이」의 사실 정리기다.
이용자가 쓴 문장에서 아래 7개 항목의 값을 정해진 목록에서만 고른다. 판단·조언·위로는 하지 않는다. 사기인지 분쟁인지 결론 내리지 않는다.

항목과 고를 수 있는 값:
${Object.entries(FACT_FIELDS).map(([k, f]) => `- ${k} (${f.label}): ${f.values.join(' / ')}`).join('\n')}

규칙:
- 문장에 분명히 나온 사실만 고른다. 추측하지 않는다. 확실하지 않으면 '모름'.
- crisis: 자해·자살을 암시하는 표현("죽고 싶다", "살기 싫다", "끝내고 싶다" 등)이 조금이라도 있으면 '있음'.
- situation: 계좌번호·금액을 잘못 입력해 보낸 경우만 '착오송금'. 거래 상대에게 보냈는데 물건 문제가 생긴 것은 '중고거래 피해'. "잘못 보낸 것 같다"처럼 어느 쪽인지 불분명하면 '모름'.
- situation: 인증번호·비밀번호를 알려 줬거나 링크를 눌러 앱을 설치했거나 기관·가족 사칭 전화·문자면 '보이스피싱 등 다른 피해'.
- receipt: "안 왔다", "일주일째 안 옴"은 '못 받음'. 기프티콘·쿠폰이 이미 사용됐거나 번호가 없으면 '쿠폰·번호가 이미 사용됨·없음'.
- contact: "답이 없다", "차단", "잠수", "읽씹"은 '답 없음·차단'. 판매 글이나 계정이 지워졌으면 '판매 글·계정 사라짐'.
- fakePost: 언급이 없으면 '모름'.
- JSON 객체 하나만 출력한다.`;

export function sanitizeFacts(raw) {
  const out = {};
  const dropped = [];
  for (const [k, f] of Object.entries(FACT_FIELDS)) {
    const v = raw && typeof raw[k] === 'string' ? raw[k].trim() : '';
    if (f.values.includes(v)) out[k] = v;
    else {
      out[k] = k === 'crisis' ? '없음' : '모름';
      if (v) dropped.push(k);
    }
  }
  return { facts: out, dropped };
}
