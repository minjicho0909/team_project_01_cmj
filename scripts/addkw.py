import os, re, sys, json

CHUNK, KW, MODE = sys.argv[1], sys.argv[2], sys.argv[3]  # MODE: check | apply
kw = json.load(open(KW, encoding="utf-8"))
files = sorted(f for f in os.listdir(CHUNK) if f.endswith(".md"))
keys = {re.match(r"^(.*_\d{2,3})_", f).group(1): f for f in files}

problems = []
missing = [k for k in keys if k not in kw]
extra = [k for k in kw if k not in keys]
if missing: problems.append(f"키워드 없는 조각: {missing}")
if extra: problems.append(f"조각 없는 키워드: {extra}")

for k, f in keys.items():
    if k not in kw: continue
    words = [w.strip() for w in kw[k].split(",")]
    if len(words) > 5: problems.append(f"{f}: 5개 넘음")
    if any(re.search(r"\d,\d", w) for w in words): problems.append(f"{f}: 숫자 쉼표")
    path = os.path.join(CHUNK, f)
    text = open(path, encoding="utf-8").read()
    lines = text.split("\n")
    if lines[1].startswith("키워드:"):
        problems.append(f"{f}: 이미 키워드 있음"); continue
    if MODE == "apply":
        lines.insert(1, "키워드: " + ", ".join(words))
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines))

print("조각", len(files), "키워드", len(kw))
for p in problems: print("문제:", p)
print("끝")
