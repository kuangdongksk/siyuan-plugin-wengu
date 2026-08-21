[中文](https://github.com/kuangdongksk/siyuan-plugin-wengu/blob/main/README.zh-CN.md)

# Wengu (温故)

A question-drilling plugin for [SiYuan](https://github.com/siyuan-note/siyuan):
import structured exercise sets, drill by chapter/exam-point/difficulty, track
wrong answers, and review them with spaced repetition — all linked back to your
textbook notes via block references.

> 温故而知新 — review the old to learn the new.

## Status

Early development. Working: the tab lists **generated exercise documents**
(persisted as real documents) in a sidebar/dropdown for drilling, and a
document-id input with "AI: make questions" converts any note into a
sibling exercise document via SiYuan's built-in AI (the AI first reports
whether it is suitable). Drilling starts by picking a timing mode
(count-up / countdown / none); per-round results (rounds done, last/best)
and total time persist with the document. Per-type answering widgets,
auto-grading for objective questions, self-assessment for brief questions,
and automatic sync of wrong answers into the "温故错题" flashcard deck.

Planned:

* [x] Import structured question sets (AI conversion via SiYuan AI)
* [ ] Drill filters (by chapter / exam point / difficulty)
* [x] Auto-grading drill mode (single/multiple/judge/fill auto, brief self-grade)
* [x] Wrong-answer book backed by SiYuan flashcards (spaced repetition)
* [ ] Question ↔ textbook linking via block references
* [ ] Database-view statistics (accuracy per exam point, review progress)

## Development

```bash
pnpm install
pnpm build   # outputs to dist/
```

Use `make install` or copy `dist/` into your SiYuan `data/plugins/siyuan-plugin-wengu/`.

## License

MIT
