[中文](https://github.com/kuangdongksk/siyuan-plugin-wengu/blob/main/README.zh-CN.md)

# Wengu (温故)

A question-drilling and vocabulary plugin for
[SiYuan](https://github.com/siyuan-note/siyuan): turn your notes into
structured exercise sets with AI, drill by chapter / knowledge point /
collection, review wrong answers, and keep everything linked back to your
textbook notes via block references — plus a spaced-repetition word trainer.

> 温故而知新 — review the old to learn the new.

## Features

- **AI conversion**: one click turns a lecture document into a sibling
  exercise document (the AI first judges whether it is suitable; detect /
  generate / knowledge-route pipeline; incremental re-conversion — after
  the source changes only the changed sections are regenerated, reconciled
  by content fingerprints)
- **Drilling**: drill by document / chapter / knowledge-point collection;
  single / multiple choice, true-false, fill-in and brief-answer widgets;
  auto-grading for objective questions (optionally AI-graded),
  self-assessment for brief answers; count-up / countdown / untimed modes;
  per-round results and total time persist with the document
- **Wrong-answer review**: wrong answers flow in and out of the
  "温故错题" flashcard deck (SiYuan spaced repetition), plus a wrong-book
  list grouped by round
- **Knowledge tree**: AI outlines a chapter into a knowledge-tree document;
  generated questions are auto-linked to knowledge points; per-section
  "drill" / "add questions"; two-way block references between questions
  and textbook notes
- **Collections**: gather questions by knowledge point into collections
  (live-view collections re-sync with the bank in real time); weakness
  profile statistics
- **Vocabulary**: multiple wordbooks (built-in CET/postgraduate lists,
  importable); a four-step ladder (EN→CN, CN→EN, listen & pick, recall);
  progress is shared across books per word
- **Statistics**: ECharts dashboards for accuracy / progress
- **AI session panel**: every AI call (grading / converting / routing…)
  is logged with full prompt and reply, and can be continued with
  follow-up questions
- **Companion mascot**: "小书童" floating companion whose expressions and
  lines react to drilling / vocabulary events (rules + AI enrichment)

## Install

1. Install "温故" from SiYuan's marketplace (Settings → Bazaar → Plugins),
   or manually: download `package.zip` from Releases and extract it to
   `<workspace>/data/plugins/siyuan-plugin-wengu/`.
2. AI features (conversion / grading / knowledge tree / companion) use
   SiYuan's built-in AI — configure a model first in Settings → AI.

## Usage

- Click the lightning icon in the top bar to open the "温故" tab (it picks
  up the exercise set of the currently active document).
- Four rail entries on the left of the tab: **Drill**, **Knowledge**
  (knowledge documents + collections), **AI sessions**, **Companion**.
- Before the first drill, use "AI: make questions" inside the tab to
  convert a lecture document, or import an existing structured exercise
  document.
- Vocabulary lives in the right dock panel (dictionary icon).

## Notes

- Runtime data such as answer statistics is self-hosted by the plugin
  (stored in its own data files) instead of polluting block attributes;
  question / knowledge-section fingerprints detect edits and offer to
  refresh the mirror.
- Every "delete document" operation goes to SiYuan's trash and is
  recoverable.

## Development

```bash
pnpm install
pnpm build   # outputs to dist/
```

Copy `dist/` into your SiYuan `data/plugins/siyuan-plugin-wengu/` to
install. See [AGENTS.md](AGENTS.md) for development and debugging details.

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) —
noncommercial use with attribution; commercial use is prohibited.
See [LICENSE](LICENSE) for the full legal code.
