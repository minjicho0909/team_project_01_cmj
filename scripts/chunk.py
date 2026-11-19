import os, re, sys, json

SRC, DST = sys.argv[1], sys.argv[2]
LIMIT, MINLEN = 1500, 100

LAW_SECTIONS = {
    "개인간거래_분쟁해결기준": lambda h: not h.startswith("개인 간 거래 분쟁해결기준이란"),
    "공정거래위원회_개인간거래분쟁해결기준보도자료_2025": lambda h: h.startswith("붙임3") or h.startswith("【별표 1】"),
}
FAQ_SECTIONS = {
    "예금보험공사_착오송금반환지원FAQ_2026": lambda h: h.startswith("Q."),
    "사기피해_돈돌려받는방법_QnA": lambda h: h == "질문",
}
ART_RE = re.compile(r"^(\*\*)?(제\d+조(의\d+)?\([^)]*\))")
BAD = re.compile(r'[\\/:*?"<>|]')


def is_table(l): return l.lstrip().startswith("|")
def is_heading(l): return re.match(r"^#{2,6} ", l) is not None
def is_boldline(l): return re.match(r"^\*\*[^*].*\*\*$", l.strip()) is not None and not ART_RE.match(l)
def is_subitem(l): return re.match(r"^\s{2,}(-|\d+\.|ㆍ)", l) is not None


def units_of(lines):
    """줄 목록 -> 단위 목록. 단위 = dict(text, sep, row(bool), header)"""
    units, i, prev_blank, cur_header = [], 0, True, None
    while i < len(lines):
        l = lines[i]
        if l.strip() == "":
            prev_blank = True; i += 1; continue
        sep = "\n\n" if prev_blank else "\n"
        prev_blank = False
        if l.startswith("[그림"):  # 그림 설명은 ] 까지 한 덩어리
            j = i
            while not lines[j].rstrip().endswith("]"): j += 1
            units.append(dict(text="\n".join(lines[i:j + 1]), sep=sep, row=False, header=None)); i = j + 1; continue
        if is_table(l):
            if sep == "\n\n" or not (units and units[-1]["row"]):
                # 새 표: 머리글 2줄 + 첫 행을 한 단위로
                header = l + "\n" + lines[i + 1]
                cur_header = header
                j = i + 2
                first = lines[j] if j < len(lines) and is_table(lines[j]) else None
                text = header + ("\n" + first if first else "")
                units.append(dict(text=text, sep=sep, row=True, header=None, starts_table=True))
                i = j + (1 if first else 0); continue
            units.append(dict(text=l, sep="\n", row=True, header=cur_header)); i += 1; continue
        if is_subitem(l) and units:
            units[-1]["text"] += "\n" + l; i += 1; continue
        units.append(dict(text=l, sep=sep, row=False, header=None)); i += 1
    # 제목(##·###·굵은 한 줄)은 다음 단위에 붙인다
    out, pending = [], None
    for u in units:
        if pending is not None:
            u = dict(u, text=pending["text"] + u["sep"] + u["text"], sep=pending["sep"], header=None if pending else u["header"])
            pending = None
        if (is_heading(u["text"]) or is_boldline(u["text"])) and "\n" not in u["text"]:
            pending = u; continue
        out.append(u)
    if pending is not None: out.append(pending)
    return out


def pack(units):
    """단위 -> 본문 조각 목록(1500자 이하, 표 이어짐 조각은 머리글 자리 남김)"""
    chunks, cur, cur_limit = [], "", LIMIT
    for u in units:
        if cur == "":
            cur = u["text"]
            cur_limit = LIMIT - (len(u["header"]) + 1) if u.get("header") else LIMIT
            continue
        cand = cur + u["sep"] + u["text"]
        if len(cand) <= cur_limit:
            cur = cand
        else:
            chunks.append(cur)
            cur = u["text"]
            cur_limit = LIMIT - (len(u["header"]) + 1) if u.get("header") else LIMIT
    if cur: chunks.append(cur)
    return chunks


def doc_chunks(name, text):
    lines = text.replace("\r\n", "\n").split("\n")
    title = lines[0][2:].strip()
    sections, cur = [], None
    pre = []
    for l in lines[1:]:
        if l.startswith("## "):
            cur = [l[3:].strip(), [l]]; sections.append(cur)
        elif cur is None:
            pre.append(l)
        else:
            cur[1].append(l)
    out = []  # dict(subs=[...], body, protected)
    if "\n".join(pre).strip():
        for b in pack(units_of(pre)):
            out.append(dict(subs=["문서정보"], body=b, protected=False))
    law = LAW_SECTIONS.get(name, lambda h: False)
    faq = FAQ_SECTIONS.get(name, lambda h: False)
    for head, sl in sections:
        if law(head):
            groups, g, label = [], [], None
            for l in sl:
                m = ART_RE.match(l)
                if m:
                    if label is not None:
                        groups.append((label, g)); g = []
                    label = m.group(2)
                g.append(l)
            groups.append((label, g))
            if groups and groups[0][0] is None and len(groups) > 1:  # 첫 조 앞의 제목은 첫 조에
                groups[1] = (groups[1][0], groups[0][1] + groups[1][1]); groups.pop(0)
            for label, g in groups:
                for b in pack(units_of(g)):
                    out.append(dict(subs=[label or head], body=b, protected=True))
        elif faq(head):
            q = head
            if q == "질문":
                q = next(l.strip() for l in sl[1:] if l.strip())
            q = re.sub(r"^Q\.\s*", "", q)
            for b in pack(units_of(sl)):
                out.append(dict(subs=[q], body=b, protected=True))
        else:
            for b in pack(units_of(sl)):
                out.append(dict(subs=[head], body=b, protected=False))
    # 100자 미만 합치기
    notes = []
    i = 0
    while i < len(out):
        c = out[i]
        if len(c["body"]) < MINLEN and not c["protected"]:
            if i + 1 < len(out):
                n = out[i + 1]
                if not n["protected"] and len(c["body"]) + 2 + len(n["body"]) <= LIMIT:
                    n["body"] = c["body"] + "\n\n" + n["body"]
                    n["subs"] = c["subs"] + [s for s in n["subs"] if s not in c["subs"]]
                    out.pop(i); continue
                notes.append(f"{name}: '{c['subs'][0]}' {len(c['body'])}자 — 다음 조각과 못 합침")
            else:
                p = out[i - 1] if i > 0 else None
                if p and not p["protected"] and len(p["body"]) + 2 + len(c["body"]) <= LIMIT:
                    p["body"] = p["body"] + "\n\n" + c["body"]
                    p["subs"] = p["subs"] + [s for s in c["subs"] if s not in p["subs"]]
                    out.pop(i); continue
                notes.append(f"{name}: '{c['subs'][0]}' {len(c['body'])}자 — 앞 조각과 못 합침")
        i += 1
    return title, out, notes


def main():
    os.makedirs(DST, exist_ok=True)
    report, allnotes = [], []
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith(".md"): continue
        name = fn[:-3]
        with open(os.path.join(SRC, fn), encoding="utf-8") as f:
            title, chunks, notes = doc_chunks(name, f.read())
        allnotes += notes
        width = 3 if len(chunks) > 100 else 2
        for k, c in enumerate(chunks, 1):
            sub = BAD.sub("", c["subs"][0].replace(" ", ""))
            out_name = f"{name}_{k:0{width}d}_{sub}.md"
            first = "출처: # " + title + " · " + " · ".join("## " + s for s in c["subs"])
            with open(os.path.join(DST, out_name), "w", encoding="utf-8", newline="\n") as f:
                f.write(first + "\n" + c["body"] + "\n")
            report.append(dict(file=name, out=out_name, n=len(c["body"]), subs=c["subs"]))
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "chunk_report.json"), "w", encoding="utf-8") as f:
        json.dump(dict(report=report, notes=allnotes), f, ensure_ascii=False, indent=1)
    from collections import Counter
    cnt = Counter(r["file"] for r in report)
    for k, v in cnt.items():
        ns = [r["n"] for r in report if r["file"] == k]
        print(f"{k}\t{v}\t최소 {min(ns)}\t최대 {max(ns)}")
    print("총", len(report))
    for n in allnotes: print("메모:", n)
    for r in report:
        if r["n"] > LIMIT: print("1500 초과:", r["out"], r["n"])


main()
