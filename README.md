# Udemy Transcript Extractor

A Chrome extension (Manifest V3) that extracts transcripts from Udemy course
lectures — one lecture at a time, or the entire course in one run — and exports
them as Markdown, plain text, JSON, or a RAG-friendly format.

## Features

- **Single lecture:** extract and copy/download the transcript of the open lecture.
- **Full course:** walk every video lecture from the current one to the end.
  Navigation is deterministic (it clicks the exact sidebar item by lecture id) and
  every transcript is verified against the lecture id in the URL before it is saved,
  so titles and transcripts never get mixed up. Lectures without captions (and
  quizzes/articles) are skipped, not mislabeled.
- **Export formats:** Markdown, plain text, JSON, and RAG chunks.

## Architecture

```
src/
  lib/
    udemy-extractor.ts    DOM scraping: curriculum, navigation, transcript panel
    content-script.ts     Runs on udemy.com; exposes operations to the popup
    extension-service.ts  Popup-side messaging + export formatting
    storage-service.ts    Persists popup UI state (chrome.storage.local)
  components/generated/
    TranscriptExtractorPopup.tsx  The popup UI (React) and bulk orchestration
public/manifest.json      MV3 manifest (Udemy host + content script + popup)
```

The popup orchestrates the bulk loop: for each video lecture it asks the content
script to navigate to that lecture id, wait until the page (URL + video + transcript
panel) has actually refreshed, extract, and assert the page is on the expected
lecture before returning the result.

## Build & install

```bash
npm install
npm run build          # outputs the extension to dist/
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select the `dist/` folder.

## Future platforms

The extractor is Udemy-only today. Support for other platforms (e.g. Facebook) can
be added as a sibling of `udemy-extractor.ts` plus a branch in the content script.
