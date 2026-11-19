# scripts

답변참고문서를 청킹할 때 쓴 스크립트. 모두 `python -I -X utf8` 로 실행한다. 경로는 인자로 넘긴다.

| 파일 | 하는 일 | 실행 예 |
|---|---|---|
| chunk.py | 청킹전/*.md 를 규칙대로 잘라 청킹/ 에 저장(1500자, 법령은 조마다, FAQ는 질문·답 한 쌍마다, 표는 행 사이) | `python -I -X utf8 scripts/chunk.py docs/답변참고문서/청킹전 docs/답변참고문서/청킹` |
| addheader.py | 표가 잘려 머리글이 없는 조각에 청킹전의 머리글 행을 다시 넣음 | `python -I -X utf8 scripts/addheader.py docs/답변참고문서/청킹 docs/답변참고문서/청킹전 apply` (`check` 는 검사만) |
| addkw.py | keywords.json 의 키워드를 조각 2행에 넣음 | `python -I -X utf8 scripts/addkw.py docs/답변참고문서/청킹 scripts/keywords.json apply` |
| cleanup.py | 2026-11-12 점검 결정(docs/결정사항.md D1~D5) 적용: 팀 메모 빼기, 지급정지 05 단서, 별표 1 출처 줄, 키워드 수정, 21개 조각을 제외/점검후_제외_조각 으로 옮김 | `python -I -X utf8 scripts/cleanup.py docs/답변참고문서` |
| keywords.json | 지금 청킹/ 조각 102개의 키워드(점검 후 상태) | |

## 다시 자를 때 주의

- chunk.py 는 청킹전 전체를 다시 자르므로, **제외/ 로 뺀 조각(공정위 담당부서·비율표 등, 지급정지 03·04·06·07, 예보 FAQ 04·05)이 되살아난다.** 다시 잘랐다면 그 조각들을 다시 제외/ 로 옮겨야 한다.
- 순서: chunk.py → addheader.py → cleanup.py 의 D2(05 단서)·D4(별표 1 출처 줄) 부분과 제외 옮기기 → addkw.py. cleanup.py 는 지금 상태에 한 번 적용한 스크립트라 그대로 다시 돌리면 "변화 없음"이 나오거나 파일을 못 찾는다. 다시 자를 일이 생기면 Claude에게 이 순서대로 해 달라고 요청한다.
- 조각 번호가 바뀌면 keywords.json 의 키(파일 이름 앞부분)도 맞춰야 한다.
