# Project working rules

- Before changing source, configuration or documentation, or packing an extension, run `python tools/backup.py`. Continue only after per-file SHA-256 verification succeeds. Keep old installation packages and historical backups. One verified backup covers a continuous set of changes.
- Full reading completes each sentence without actively pausing or resuming the video. Effective speech rate is the user base rate multiplied by video playback rate. Changing rate must preserve the queue.
- Semantic segmentation and display pagination apply only to explicitly identified ASR captions. Native/manual captions retain their original text and time boundaries. Translation does not change the caption type. Unknown captions retain their rows.
- Never commit signing keys, API keys, credentials, private recordings or local backup archives.
- Run `npm test` and `npm run build:syntax` for relevant source changes; use appropriate Edge integration checks for playback or speech changes.
