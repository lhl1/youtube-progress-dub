# Changelog

## 1.7.7 — 2026-11-19

- Add Alibaba Cloud Machine Translation General Edition as a selectable provider, using the official TranslateGeneral API.
- Store Alibaba Cloud credentials in trusted local extension storage and sign the requests in the worker.
- Retry YouTube fallback after the current caption load completes if Google is rate-limited during that load.

## 1.7.6 — 2026-11-19

- Add a keyless YouTube-only translation option for available Chinese caption tracks, including translated ASR tracks.
- Respect Google rate limits across video tabs. Try YouTube when no translation is ready and the YouTube preference is enabled.
- Add Azure Translator with a separate key and resource region, plus an opt-in Azure fallback for Google failures.

## 1.7.5 — 2026-11-16

- Keep an explicitly selected or already-started voice across pause/resume, later cues, cooldowns and voice-list refreshes; wait for the original voice if it disappears. A changed user preference can select a new voice.
- Defer paused synthesis failures until playback resumes and retry transient resume errors once with the same voice and unfinished part. Keep completed parts, caption offsets, multiplied rate and the narration queue intact.
- Retain offline fallback only for automatic initial selection before any voice has started. Update the unavailable-voice hint.
- Validation: 140 unit tests pass, including 8 new voice-stability regressions; an Edge extension fixture covers paused errors, resume retries and disappearing/returning selected voices. Fixture speech output is substituted.

## 1.7.4 — 2026-11-08

- Validation: 132 unit tests pass; Edge extension fixtures cover startup, delayed voices, playback recovery and seeking. Browser scenarios substitute speech output and do not constitute an audible voice test.

- Normalize Chinese book-title delimiters and percentages only for speech, keeping original caption text and mapped character offsets.
- Skip automatic dubbing for original audio identified as Chinese; do not infer spoken language from an authored or translated Chinese caption track.
- Wait for saved startup settings, retry transient initialization failures, recover delayed voices and retry failed follow-mode narration; preserve genuine browser activation requirements.
- Resume long ASR narration near a seek position using timed source rows, available translation alignment and a safe clause/word boundary. Normal uninterrupted reading stays complete; authored and unknown caption rows remain unchanged.
- Keep caption text, display styles, semantic grouping and pagination unchanged. Seek placement is approximate without word-level cross-language timing.

## 1.7.2 — 2026-10-24

- Remove the page counter above captions while preserving automatic-caption pagination, bilingual display and complete narration.

## 1.7.1 — 2026-10-09

- Skip square-bracket annotations, full-width variants, symbols and complete emoji graphemes during narration, using short silent pauses while preserving caption text and original character offsets.
- Complete annotation-only source cues silently even if translation removes their brackets; no voice or gesture is required for silent parts.
- Freeze remaining silence on pause, preserve video-relative rate for following speech, and cancel stale timers on stop or seek.
- Ask custom translators to retain brackets around sound/stage annotations.
- Add 7 regression tests (121 total) and an Edge annotation integration scenario; native caption and ASR pagination fixtures remain covered.

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
