// 답변참고문서 조각 읽기와 검색.
// 결정사항 S3: 서버가 읽는 경로는 docs/답변참고문서/청킹/*.md 하나로 고정 (원본·청킹전·제외 는 읽지 않는다)
// 결정사항 S4: …_문서정보 조각은 검색에서 빼고, 원문 주소를 보여 줄 때만 쓴다
// 결정사항 S5: 1행(출처:)·2행(키워드:)은 본문과 떼어 처리, 근거 표시는 「문서 이름 · 소제목」(# 없이), <br> 은 줄바꿈

import fs from 'node:fs';
import path from 'node:path';

const CHUNK_DIR = path.join(process.cwd(), 'docs', '답변참고문서', '청킹');
let cache = null;

function cleanTitle(s) {
  return s.replace(/#+\s*/g, '').replace(/\s+/g, ' ').trim();
}

function load() {
  if (cache) return cache;
  const files = fs.readdirSync(CHUNK_DIR).filter((f) => f.endsWith('.md')).sort();
  const all = files.map((file) => {
    const raw = fs.readFileSync(path.join(CHUNK_DIR, file), 'utf8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/);
    const src = (lines[0] || '').replace(/^출처:\s*/, '');
    const kw = (lines[1] || '').startsWith('키워드:') ? lines[1].replace(/^키워드:\s*/, '') : '';
    const body = lines.slice(kw ? 2 : 1).join('\n').replace(/<br\s*\/?>/gi, '\n').trim();
    const [docPart, ...secParts] = src.split(' · ');
    const doc = cleanTitle(docPart || file);
    const section = cleanTitle(secParts.join(' · '));
    const prefix = file.replace(/_\d{2}_[^_]*\.md$/, '').replace(/\.md$/, '');
    return {
      id: file,
      prefix,
      doc,
      section,
      label: section ? `${doc} · ${section}` : doc,
      keywords: kw.split(',').map((s) => s.trim()).filter(Boolean),
      body,
      isInfo: /_문서정보\.md$/.test(file),
    };
  });
  const info = {};
  for (const c of all.filter((c) => c.isInfo)) {
    const url = (c.body.match(/https?:\/\/\S+/) || [])[0] || '';
    info[c.prefix] = url.replace(/[)\].,]+$/, '');
  }
  cache = { chunks: all.filter((c) => !c.isInfo), info };
  return cache;
}

// 진단 결과별로 먼저 볼 문서(결정사항 S8: 버튼 진단으로 먼저 가른 뒤 검색)
const PREFER = {
  fraud: ['경찰청_', '생활법령_중고거래_피해_신고와_대응', '법제처_온라인직거래피해', '기사요약_중고사기_계좌_지급정지', '지급정지_', '사기피해_', '방송통신위원회_', '법제처_중고거래피해자지원', '기프티콘_', '기사요약_기프티콘', '기사요약_AI_조작'],
  dispute: ['공정거래위원회_', '분쟁조정위원회_', '생활법령_중고거래_피해_해결', '기사요약_KISA', '대한법률구조공단_', '법제처_지급명령', '방송통신위원회_'],
  mistransfer: ['예금보험공사_', '기사요약_착오송금'],
  phishing: ['금융감독원_', '지급정지_'],
  unclear: ['방송미디어통신위원회_', '방송통신위원회_', '생활법령_'],
};

// 이용자 말 → 조각에 쓰인 말 (검색어에 덧붙인다)
const SYNONYMS = [
  [/챙기|챙겨|준비|가져가|뭘 가지고|필요한 것|서류/, '준비 신분증 입증 자료 채팅 내용 입금내역 증거'],
  [/잠수|먹튀|읽씹|연락이 안|연락 두절|차단/, '연락두절 연락 두절 사기'],
  [/지급\s?정지|계좌.*묶|돈.*묶/, '지급정지 계좌 지급정지'],
  [/돌려받|환불|회수|받아낼/, '돈 돌려받 지급명령 반환 조정'],
  [/조정|합의/, '분쟁조정 조정 신청'],
  [/쿠폰|기프티콘|상품권|교환권/, '기프티콘 쿠폰 양도'],
  [/잘못 보냈|잘못 송금|잘못 입력/, '착오송금 반환지원'],
];

function tokens(text) {
  const extra = SYNONYMS.filter(([re]) => re.test(text)).map(([, w]) => w).join(' ');
  text = `${text} ${extra}`;
  return (String(text).toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || [])
    .flatMap((w) => (w.length >= 4 && /[가-힣]/.test(w) ? [w, w.slice(0, 2), w.slice(0, 3)] : [w]));
}

export function searchChunks(query, category, k = 4) {
  const { chunks, info } = load();
  const q = [...new Set(tokens(query))];
  const prefer = PREFER[category] || [];
  const scored = chunks.map((c) => {
    let s = 0;
    const kwText = c.keywords.join(' ').toLowerCase();
    const head = `${c.doc} ${c.section}`.toLowerCase();
    const body = c.body.toLowerCase();
    for (const t of q) {
      if (kwText.includes(t)) s += 3;
      if (head.includes(t)) s += 2;
      if (body.includes(t)) s += 1;
    }
    if (s > 0 && prefer.some((p) => c.prefix.startsWith(p))) s += 4;
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const top = scored[0]?.s || 0;
  // 가장 관련 있는 조각의 절반에 못 미치는 조각은 근거로 쓰지 않는다(엉뚱한 출처가 붙지 않게)
  return scored.filter((x) => x.s >= top * 0.5).slice(0, k).map(({ c, s }) => ({ id: c.id, label: c.label, body: c.body, url: info[c.prefix] || '', score: s }));
}

export function chunkCount() {
  return load().chunks.length;
}
