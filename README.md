# Course Transcript Extractor

A Chrome extension (Manifest V3) that extracts transcripts and readings from
online courses and exports them as Markdown, plain text, JSON, or a RAG-friendly
format.

Supported platforms:

- **Udemy** — one lecture at a time, or the entire course in one run.
- **Google Skills** (`partner.skills.google`, `www.skills.google`,
  `cloudskillsboost.google`) — one course, or a whole learning path, as a ZIP with
  one `.md` per activity.

## Udemy

- **Single lecture:** extract and copy/download the transcript of the open lecture.
- **Full course:** walk every video lecture from the current one to the end.
  Navigation is deterministic (it clicks the exact sidebar item by lecture id) and
  every transcript is verified against the lecture id in the URL before it is saved,
  so titles and transcripts never get mixed up. Lectures without captions (and
  quizzes/articles) are skipped, not mislabeled.
- **Export formats:** Markdown, plain text, JSON, and RAG chunks.

## Google Skills

Open a learning path (`/paths/<id>`) or any page of a course
(`/course_templates/<id>`, `/paths/<id>/course_templates/<id>/...`), open the popup
and pick **Extraer este curso** or **Extraer ruta completa**.

Nothing is played or navigated. Every activity is read from the server-rendered HTML
of its own page with a same-origin `fetch()` (your logged-in session is used):

| Activity | Source | Result |
|---|---|---|
| `video` | `transcript` attribute of `<ql-youtube-video>` (JSON of `{time, text}` cues) | `# Transcript` |
| `link` / `document` | `<ql-iframe>` → Rise course package; text decoded from `runtime-data.js` (newer), `locales/<lang>.js` (older) or inlined in `index.html` | `# Reading` |
| `lab`, `quiz` | not extractable | skipped |

> **Side effect:** requesting a reading page (`/documents/<id>`) makes Google Skills
> create a session for that course, i.e. the course shows as started ("Continue").
> Progress stays at 0 %: nothing is marked as completed. Video pages have no such
> effect. Extracting a whole path therefore starts every course in it that has readings.

The ZIP contains one folder per course, files named `NN-Title.md`, and a
`_manifest.json` with the status of every activity (completed / skipped / failed and
why). YouTube videos embedded inside readings are kept as links; their transcripts
are not fetched.

## Architecture

```
src/
  lib/
    udemy-extractor.ts    Udemy DOM scraping: curriculum, navigation, transcript panel
    skills-extractor.ts   Google Skills: fetch + parse activities, Rise packages, HTML→Markdown
    skills-format.ts      Popup-side transcript formatting (see note below)
    content-script.ts     Runs on the supported sites; exposes operations to the popup
    extension-service.ts  Popup-side messaging + export formatting
    storage-service.ts    Persists popup UI state (chrome.storage.local)
  components/generated/
    TranscriptExtractorPopup.tsx  The popup UI (React) and Udemy bulk orchestration
    SkillsPanel.tsx               Google Skills UI: course/path extraction and ZIP export
public/manifest.json      MV3 manifest (hosts + content script + popup)
```

The popup orchestrates the loops (one message per Udemy lecture / per Skills
activity) so progress and cancellation live in the UI.

> **Content-script bundling:** a classic content script cannot `import` another file.
> Anything used by both the content script and the popup would be split into a shared
> chunk and break the content script, so popup-only helpers live in their own module
> (`skills-format.ts`) and the popup only `import type`s from `skills-extractor.ts`.
> After a build, `dist/content-script.js` must contain no `import` statements.

## Build & install

```bash
npm install
npm run build:extension   # outputs the extension to dist/
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select the `dist/` folder. After rebuilding, reload the extension **and** the course
tab (the content script is injected at page load).

## Adding another platform

Add a sibling of `skills-extractor.ts`, route it in `content-script.ts`
(`CHECK_AVAILABILITY` reports the `platform`), and give it a panel next to
`SkillsPanel.tsx`.
