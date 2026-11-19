import os, re, sys, json

CHUNK, SRC, MODE = sys.argv[1], sys.argv[2], sys.argv[3]  # MODE: check | apply
SEP = re.compile(r"^\|(\s*:?-+:?\s*\|)+\s*$")


def tables_in(lines):
    """연속된 | 줄 묶음의 (시작, 끝) 목록"""
    out, i = [], 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"): j += 1
            out.append((i, j)); i = j
        else:
            i += 1
    return out


src_docs = {}
for fn in os.listdir(SRC):
    if fn.endswith(".md"):
        with open(os.path.join(SRC, fn), encoding="utf-8") as f:
            src_docs[fn[:-3]] = f.read().split("\n")

rows = []
for fn in sorted(os.listdir(CHUNK)):
    if not fn.endswith(".md"): continue
    path = os.path.join(CHUNK, fn)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    lines = text.split("\n")
    tabs = tables_in(lines[1:])
    if not tabs: continue
    doc = re.sub(r"_\d{2,3}_.*$", "", fn[:-3])
    src = src_docs[doc]
    inserts = []
    for a, b in tabs:
        a1 = a + 1  # 첫 줄(출처) 보정
        has_header = (a1 + 1 < len(lines)) and SEP.match(lines[a1 + 1].strip())
        if has_header:
            continue
        first_row = lines[a1]
        # 청킹전에서 이 행이 든 표의 머리글 2줄 찾기
        header = None
        for sa, sb in tables_in(src):
            if first_row in src[sa:sb]:
                header = src[sa:sa + 2]
                break
        inserts.append((a1, header, first_row))
    body_len_before = len("\n".join(lines[1:]).rstrip("\n"))
    for a1, header, first_row in reversed(inserts):
        if header and MODE == "apply":
            lines[a1:a1] = header
    if MODE == "apply" and inserts:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines))
    body_len_after = len("\n".join(lines[1:]).rstrip("\n"))
    if inserts:
        for a1, header, first_row in inserts:
            rows.append(dict(file=fn, header=header[0] if header else None, before=body_len_before, after=body_len_after))
    else:
        rows.append(dict(file=fn, header="", before=body_len_before, after=body_len_after))

print(json.dumps(rows, ensure_ascii=False, indent=0))
