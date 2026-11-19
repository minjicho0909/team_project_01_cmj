import os, re, sys, shutil, glob

BASE = sys.argv[1]  # docs/답변참고문서
CH, PRE, EX = [os.path.join(BASE, d) for d in ("청킹", "청킹전", "제외")]
log = []


def edit(path, fn):
    with open(path, encoding="utf-8") as f:
        old = f.read()
    new = fn(old)
    if new == old:
        log.append(f"변화 없음!! {os.path.basename(path)}")
        return
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new)
    log.append(f"고침: {os.path.relpath(path, BASE)}")


def drop_lines(pattern):
    rx = re.compile(pattern)
    def fn(t):
        lines = [l for l in t.split("\n") if not rx.search(l)]
        out = "\n".join(lines)
        return re.sub(r"\n{3,}", "\n\n", out)
    return fn


def replace(a, b):
    return lambda t: t.replace(a, b)


def chain(*fns):
    def fn(t):
        for f in fns: t = f(t)
        return t
    return fn


def one(folder, pattern):
    hits = glob.glob(os.path.join(folder, pattern))
    assert len(hits) == 1, (pattern, hits)
    return hits[0]


# ---- D1 팀 메모 (청킹 + 청킹전) ----
memo = chain(
    drop_lines(r"^- 챗봇 안내 시사점:"),
    drop_lines(r"^- 비고:"),
    drop_lines(r"^- 찾은 곳:"),
    replace(" (원본 PDF는 docs/보관자료에 보관)", ""),
    replace("예금보험공사 FAQ(수집 2026-11-05, 예금보험공사_착오송금반환지원FAQ_2026.md)", "예금보험공사 FAQ(수집 2026-11-05)"),
    replace("(기사요약_착오송금_반환지원_제외대상.md)", "(헤럴드경제 2025. 9. 20. 보도)"),
    replace(" ⇒ 질문6 참조)", ")"),
)
targets_ch = [
    "기사요약_AI_조작_인증사진_01_*", "기사요약_기프티콘_중고거래_사기_02_*", "기사요약_온라인피해365센터_사칭_주의_01_*",
    "기사요약_중고사기_계좌_지급정지_01_*", "기사요약_착오송금_반환지원_제외대상_01_*",
    "방송통신위원회_2023_온라인피해상담사례집_요약_01_*", "생활법령_중고거래_피해_해결_01_*", "분쟁조정위원회_자주하는_질문_01_*",
    "예금보험공사_착오송금_반환지원_절차_01_*", "예금보험공사_착오송금_반환지원_절차_03_*", "예금보험공사_착오송금반환지원FAQ_2026_11_*",
]
for p in targets_ch: edit(one(CH, p + ".md"), memo)
targets_pre = [
    "기사요약_AI_조작_인증사진", "기사요약_기프티콘_중고거래_사기", "기사요약_온라인피해365센터_사칭_주의",
    "기사요약_중고사기_계좌_지급정지", "기사요약_착오송금_반환지원_제외대상",
    "방송통신위원회_2023_온라인피해상담사례집_요약", "생활법령_중고거래_피해_해결", "분쟁조정위원회_자주하는_질문",
    "예금보험공사_착오송금_반환지원_절차", "예금보험공사_착오송금반환지원FAQ_2026",
]
for p in targets_pre: edit(os.path.join(PRE, p + ".md"), memo)

# ---- D2 지급정지 05 단서 ----
note = ('※ 이 법의 "전기통신금융사기"에서는 "재화의 공급 또는 용역의 제공 등을 가장한 행위는 제외하되, '
        '대출의 제공ㆍ알선ㆍ중개를 가장한 행위는 포함한다"(「전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법」 제2조제2호 단서).')
edit(one(CH, "지급정지_전기통신금융사기_05_*.md"),
     replace("## 금융회사의 지급정지 조치\n\n", "## 금융회사의 지급정지 조치\n\n" + note + "\n\n"))

# ---- D4 별표 1 출처 줄 ----
for n in range(11, 27):
    path = one(CH, f"공정거래위원회_개인간거래분쟁해결기준보도자료_2025_{n}_*.md")
    def fix(t):
        first, rest = t.split("\n", 1)
        first2 = re.sub(r" · ## (제\d+조)", r" · ## 【별표 1】 \1", first, count=1)
        return first2 + "\n" + rest
    edit(path, fix)

# ---- D5 키워드 ----
KW = {
    "정책브리핑_자살예방_상담전화_109_통합_02_*": "자살예방 상담전화, 109, 죽고 싶어, 자살 위기, 극단적 선택",
    "방송통신위원회_2023_온라인피해상담사례집_요약_03_*": "입금했는데 물건 안 옴, 잠수, 먹튀, 가짜 안전결제 링크, ECRM",
    "생활법령_중고거래_피해_해결_02_*": "사기죄, 먹튀, 잠수, 허위 안전결제 링크, 가품",
    "경찰청_사이버범죄신고사건처리절차_2026_03_*": "접수대상, 사기 신고, 먹튀, 비접수 대상, 민사 소송",
    "기사요약_기프티콘_중고거래_사기_02_*": "기프티콘, 모바일 쿠폰, 이미 사용된 쿠폰, 먹튀, 안전결제",
    "사기피해_돈돌려받는방법_QnA_02_*": "사기당한 돈, 먹튀 돈 돌려받기, 배상명령, 지급명령, 소액심판",
    "기사요약_착오송금_반환지원_제외대상_01_*": "착오송금, 계좌번호 잘못 입력, 반환지원 제외, 범죄 이용 계좌, 사기 피해금",
    "예금보험공사_착오송금_반환지원_절차_02_*": "착오송금, 계좌번호 잘못 입력, 1억 원, 반환지원 절차, 부당이득반환채권",
    "예금보험공사_착오송금반환지원FAQ_2026_02_*": "대상 금액, 5만원, 1억원, 계좌번호 잘못 입력, 1년 이내",
    "예금보험공사_착오송금반환지원FAQ_2026_06_*": "방문 신청, 온라인 신청, 고객도우미실, 착오송금 신청, 계좌번호 잘못 입력",
    "예금보험공사_착오송금반환지원FAQ_2026_13_*": "신청 기한, 1년 이내, 착오송금일, 언제까지, 계좌번호 잘못 입력",
}
for p, kw in KW.items():
    def setkw(t, kw=kw):
        lines = t.split("\n")
        assert lines[1].startswith("키워드: ")
        lines[1] = "키워드: " + kw
        return "\n".join(lines)
    edit(one(CH, p + ".md"), setkw)

# ---- D2·D3 제외로 옮기기 (마지막에) ----
dst = os.path.join(EX, "점검후_제외_조각")
os.makedirs(dst, exist_ok=True)
moves = [f"지급정지_전기통신금융사기_{n}_*" for n in ("03", "04", "06", "07")]
moves += [f"공정거래위원회_개인간거래분쟁해결기준보도자료_2025_{n:02d}_*" for n in [4] + list(range(27, 41))]
moves += [f"예금보험공사_착오송금반환지원FAQ_2026_{n}_*" for n in ("04", "05")]
moved = []
for p in moves:
    src = one(CH, p + ".md")
    shutil.move(src, os.path.join(dst, os.path.basename(src)))
    moved.append(os.path.basename(src))

print("\n".join(log))
print("옮긴 조각", len(moved))
print("\n".join(moved))
