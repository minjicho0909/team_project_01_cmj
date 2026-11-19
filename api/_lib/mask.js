// AI 에 보내기 전에 계좌번호·전화번호·주민등록번호·이메일 모양을 가린다 (기획서 Ⅶ-2 개인정보)

const RULES = [
  { name: '주민등록번호', re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/g, to: '[주민번호 가림]' },
  { name: '전화번호', re: /\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, to: '[전화번호 가림]' },
  { name: '전화번호', re: /\b0\d{1,2}[-\s.]\d{3,4}[-\s.]\d{4}\b/g, to: '[전화번호 가림]' },
  { name: '이메일', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, to: '[이메일 가림]' },
  // 하이픈이 든 계좌번호 모양(숫자 묶음 3~4개, 전체 10자리 이상)
  { name: '계좌번호', re: /\b\d{2,6}(?:-\d{2,7}){2,3}\b/g, to: '[계좌번호 가림]' },
  // 하이픈 없는 긴 숫자(10~16자리)
  { name: '계좌번호', re: /\b\d{10,16}\b/g, to: '[계좌번호 가림]' },
];

export function maskPersonal(text) {
  let out = String(text || '');
  const found = new Set();
  for (const r of RULES) {
    out = out.replace(r.re, (m) => {
      // 금액(예: 150,000) 은 쉼표가 있어 위 규칙에 걸리지 않는다
      found.add(r.name);
      return r.to;
    });
  }
  return { text: out, masked: [...found] };
}
