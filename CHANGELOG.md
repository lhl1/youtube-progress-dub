# Changelog

## 1.7.0 — 2026-10-09

- Improve ASR translation units to retain direct objects, complements, conditions, causes and the scope of reported speech, including short hesitations before a continuation.
- Redesign Chinese display pagination around punctuation and word boundaries with a smaller soft viewport budget; keep complete translation and narration independent of pages.
- Use validated coarse translation sentence correspondences for bilingual display, with whole-source fallback instead of character-ratio guesses.
- Supply bounded ASR context and a natural-Chinese translation prompt to custom providers; add terminal punctuation only to English ASR translation input.
- Preserve natural boundaries in long TTS parts and avoid resetting identical transcripts received twice.
- Invalidate old ASR translations while preserving native caption behavior and user settings.
- Validate with 114 unit tests, Edge ASR/native/pause integration checks and 12 real Google translation observations. [Research and limitations](docs/asr-segmentation-v1.7.0.md).

## 1.6.1 — 2026-10-09

- Restrict semantic segmentation and long-sentence display pagination to explicitly identified automatic (ASR) captions.
- Preserve native/manual caption rows and time boundaries, including automatically translated native captions and unknown caption types.
- Carry caption type consistently through source selection, translation, display, and caching.
- Initial public release includes complete-reading queues, video-relative speech rate, continuous original-volume cap, player settings, ASR sentence inference, subtitle styling, and 103 unit tests.
