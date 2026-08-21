[中文](https://github.com/kuangdongksk/siyuan-plugin-wengu/blob/main/README.zh-CN.md)

# Wengu (温故)

A question-drilling plugin for [SiYuan](https://github.com/siyuan-note/siyuan):
import structured exercise sets, drill by chapter/exam-point/difficulty, track
wrong answers, and review them with spaced repetition — all linked back to your
textbook notes via block references.

> 温故而知新 — review the old to learn the new.

## Status

Early development. Skeleton stage: top-bar entry + dock panel.

Planned:

- [ ] Import structured question sets (markdown / parsed exercise books)
- [ ] Drill mode (filter by chapter / exam point / difficulty, auto-grade
      multiple choice)
- [ ] Wrong-answer book backed by SiYuan flashcards (spaced repetition)
- [ ] Question ↔ textbook linking via block references
- [ ] Database-view statistics (accuracy per exam point, review progress)

## Development

```bash
pnpm install
pnpm build   # outputs to dist/
```

Use `make install` or copy `dist/` into your SiYuan `data/plugins/siyuan-plugin-wengu/`.

## License

MIT
