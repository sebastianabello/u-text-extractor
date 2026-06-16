// Udemy Transcript Extractor
// Scrapes the course curriculum and the in-page transcript panel of Udemy lectures.

export interface UdemyLecture {
  id: string; // numeric Udemy lecture id (from the /learn/lecture/<id> href)
  title: string;
  duration: string;
  isCurrent: boolean;
  isVideo: boolean; // false for quizzes / articles / other non-video items
}

export interface UdemySection {
  id: string;
  title: string;
  duration: string;
  lectures: UdemyLecture[];
}

export interface UdemyCourse {
  title: string;
  instructor: string;
  sections: UdemySection[];
  currentLecture?: UdemyLecture;
}

export interface TranscriptResult {
  lectureId: string; // the lecture the transcript was actually read from (from the URL)
  transcript: string;
}

const SELECTORS = {
  TRANSCRIPT_PANEL: '[data-purpose="transcript-panel"]',
  TRANSCRIPT_CUE: '[data-purpose="transcript-cue"]',
  TRANSCRIPT_TOGGLE: 'button[data-purpose="transcript-toggle"]',
  COURSE_TITLE: 'h1[data-purpose="course-title"]',
  SECTION_TITLE: '.ud-accordion-panel-title',
  SIDEBAR_SECTIONS: '[data-purpose^="section-panel-"]',
  SIDEBAR_LECTURES: '[data-purpose^="curriculum-item-"]',
  LECTURE_ITEM_TITLE: '[data-purpose="item-title"]',
  LECTURE_LINK: 'a[href*="/learn/lecture/"]',
} as const;

const CUE_SELECTORS = [
  SELECTORS.TRANSCRIPT_CUE,
  '.transcript--cue-container--Vuwj6',
  '.transcript-cue',
] as const;

export class UdemyExtractor {
  // ---------------------------------------------------------------------------
  // Page / location helpers
  // ---------------------------------------------------------------------------

  static isUdemyCoursePage(): boolean {
    return (
      window.location.hostname.includes('udemy.com') &&
      window.location.pathname.includes('/course/')
    );
  }

  /** Numeric lecture id parsed from the current URL, or '' if not on a lecture. */
  static getCurrentLectureId(): string {
    const match = window.location.pathname.match(/\/learn\/lecture\/(\d+)/);
    return match ? match[1] : '';
  }

  // ---------------------------------------------------------------------------
  // Course structure
  // ---------------------------------------------------------------------------

  static extractCourseStructure(): UdemyCourse | null {
    try {
      return {
        title: this.getCourseTitle(),
        instructor: this.getInstructorName(),
        sections: this.extractSections(),
        currentLecture: this.getCurrentLecture(),
      };
    } catch (error) {
      console.error('Error extracting course structure:', error);
      return null;
    }
  }

  private static extractSections(): UdemySection[] {
    let sectionElements = document.querySelectorAll(SELECTORS.SIDEBAR_SECTIONS);

    if (sectionElements.length === 0) {
      for (const selector of ['.ud-accordion-panel', '[data-purpose*="section"]']) {
        const alt = document.querySelectorAll(selector);
        if (alt.length > 0) {
          sectionElements = alt;
          break;
        }
      }
    }

    return Array.from(sectionElements).map((sectionEl, index) => ({
      id: `section-${index}`,
      title: this.extractSectionTitle(sectionEl),
      duration: this.extractSectionDuration(sectionEl),
      lectures: this.extractLectures(sectionEl),
    }));
  }

  private static extractSectionTitle(sectionEl: Element): string {
    return sectionEl.querySelector(SELECTORS.SECTION_TITLE)?.textContent?.trim() || 'Untitled Section';
  }

  private static extractSectionDuration(sectionEl: Element): string {
    const text = sectionEl.querySelector('[data-purpose="section-duration"]')?.textContent?.trim() || '';
    const match = text.match(/\|\s*(\d+min|\d+hr\s*\d+min)/);
    return match ? match[1] : '';
  }

  private static extractLectures(sectionEl: Element): UdemyLecture[] {
    const items = sectionEl.querySelectorAll(SELECTORS.SIDEBAR_LECTURES);
    const elements = items.length > 0
      ? Array.from(items)
      : Array.from(sectionEl.querySelectorAll(SELECTORS.LECTURE_LINK));

    return elements.map((el, index) => {
      const { id, isVideo } = this.extractLectureIdentity(el);
      return {
        id: id || `item-${index}`,
        title: this.extractLectureTitle(el),
        duration: this.extractLectureDuration(el),
        isCurrent: id !== '' && id === this.getCurrentLectureId(),
        isVideo,
      };
    });
  }

  /** Returns the lecture's numeric id and whether it is a real video lecture. */
  private static extractLectureIdentity(el: Element): { id: string; isVideo: boolean } {
    const anchor =
      (el.matches?.(SELECTORS.LECTURE_LINK) ? el : null) ||
      el.querySelector(SELECTORS.LECTURE_LINK);
    const href = anchor?.getAttribute('href') || '';
    const lectureMatch = href.match(/\/learn\/lecture\/(\d+)/);
    if (lectureMatch) {
      return { id: lectureMatch[1], isVideo: true };
    }
    // Non-video item (quiz, article, practice...) — keep a stable id but mark not-video.
    const dp = el.getAttribute('data-purpose') || '';
    const dpMatch = dp.match(/curriculum-item-(\d+)/);
    return { id: dpMatch ? dpMatch[1] : '', isVideo: false };
  }

  private static extractLectureTitle(el: Element): string {
    const titleEl = el.querySelector(SELECTORS.LECTURE_ITEM_TITLE);
    if (titleEl?.textContent?.trim()) {
      return titleEl.textContent.trim();
    }
    const ownText = el.textContent?.trim();
    return ownText && ownText.length > 0 && ownText.length < 200 ? ownText : 'Untitled Lecture';
  }

  private static extractLectureDuration(el: Element): string {
    const durationEl = el.querySelector(
      '.curriculum-item-link--metadata--XK804 span:last-child, .ud-text-xs span:last-child'
    );
    return durationEl?.textContent?.trim() || '';
  }

  private static getCurrentLecture(): UdemyLecture | undefined {
    const currentId = this.getCurrentLectureId();
    if (!currentId) return undefined;

    const link = document.querySelector(`${SELECTORS.LECTURE_LINK}[href*="/learn/lecture/${currentId}"]`);
    const item = link?.closest(SELECTORS.SIDEBAR_LECTURES) || link;
    return {
      id: currentId,
      title: item ? this.extractLectureTitle(item) : this.getVideoTitleFromPage() || 'Current Lecture',
      duration: item ? this.extractLectureDuration(item) : '',
      isCurrent: true,
      isVideo: true,
    };
  }

  private static getCourseTitle(): string {
    return document.querySelector(SELECTORS.COURSE_TITLE)?.textContent?.trim() || 'Untitled Course';
  }

  private static getInstructorName(): string {
    return (
      document.querySelector('[data-purpose="instructor-name"], .instructor-name')?.textContent?.trim() ||
      'Unknown Instructor'
    );
  }

  private static getVideoTitleFromPage(): string | null {
    // Specific lecture-title selectors only — never generic h1/.ud-heading-xl, which
    // match unrelated page headings like the course's "What you'll learn" section.
    for (const selector of [
      '[data-purpose="lecture-header-title"]',
      '[data-purpose="lecture-title"]',
      '[data-purpose="video-title"]',
    ]) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    const pageTitle = document.title.replace(/\s*\|\s*Udemy\s*$/i, '');
    return pageTitle.includes('|') ? pageTitle.split('|')[0].trim() : pageTitle.trim() || null;
  }

  static getCurrentVideoInfo(): { title: string; duration: string } | null {
    const current = this.getCurrentLecture();
    if (current) return { title: current.title, duration: current.duration };
    const title = this.getVideoTitleFromPage();
    return title ? { title, duration: 'Unknown' } : null;
  }

  // ---------------------------------------------------------------------------
  // Navigation — driven by Udemy's own "Next" button in the player bar (the
  // approach that reliably advances lectures). The title and id are read from the
  // live page after navigation, so a transcript is never paired with the wrong
  // lecture, and we wait for fresh content before reading it.
  // ---------------------------------------------------------------------------

  /** Title, id and sidebar key of the lecture currently loaded in the player. */
  static getCurrentLectureMeta(): { lectureId: string; title: string; currentKey: string } {
    return {
      lectureId: this.getCurrentLectureId(),
      // Title comes from the sidebar item (real lecture name). Never fall back to
      // document.title, which is the course name.
      title: this.getCurrentItemTitle(),
      currentKey: this.getCurrentItemKey(),
    };
  }

  // The "current" lecture is marked with aria-current="true"; the is-current class
  // carries a volatile hash suffix (…--2mKk4), so we also match it by substring.
  private static getCurrentItem(): Element | null {
    return (
      document.querySelector('li[aria-current="true"]') ||
      document.querySelector('[class*="curriculum-item-link--is-current"]')?.closest('li') ||
      null
    );
  }

  /** Title of the lecture highlighted as current in the sidebar (the reliable one). */
  private static getCurrentItemTitle(): string {
    return this.getCurrentItem()?.querySelector(SELECTORS.LECTURE_ITEM_TITLE)?.textContent?.trim() || '';
  }

  /** Sidebar key (e.g. "curriculum-item-4-0") of the current item. */
  private static getCurrentItemKey(): string {
    return this.getCurrentItem()?.querySelector(SELECTORS.SIDEBAR_LECTURES)?.getAttribute('data-purpose') || '';
  }

  /**
   * Items currently rendered in the sidebar — i.e. those in expanded sections only.
   * Collapsed sections render nothing, so this is exactly the "open sections" set.
   */
  static getOpenItems(): { key: string; title: string; isVideo: boolean; isCurrent: boolean }[] {
    const items: { key: string; title: string; isVideo: boolean; isCurrent: boolean }[] = [];
    document.querySelectorAll(SELECTORS.SIDEBAR_LECTURES).forEach((el) => {
      const key = el.getAttribute('data-purpose') || '';
      if (!key) return;
      const li = el.closest('li');
      items.push({
        key,
        title: el.querySelector(SELECTORS.LECTURE_ITEM_TITLE)?.textContent?.trim() || 'Lecture',
        isVideo: this.itemIcon(el) === 'video',
        isCurrent: li?.getAttribute('aria-current') === 'true',
      });
    });
    return items;
  }

  /** Classifies a curriculum item by its type icon (video / article / quiz). */
  private static itemIcon(el: Element): string {
    for (const use of Array.from(el.querySelectorAll('use'))) {
      const href = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
      if (href.includes('icon-video')) return 'video';
      if (href.includes('icon-article')) return 'article';
      if (href.includes('icon-quiz')) return 'quiz';
    }
    return 'other';
  }

  private static hoverPlayer(): void {
    const container =
      document.querySelector('[data-purpose="video-display"]') ||
      document.querySelector('.video-js') ||
      document.querySelector('video');
    container?.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: 400, clientY: 300 })
    );
  }

  /** Finds the player's "Next"/"Previous" button, or null if absent/disabled. */
  private static findNavButton(dir: 'next' | 'prev'): HTMLElement | null {
    const selectors =
      dir === 'next'
        ? ['[data-purpose="go-to-next"]', '#go-to-next-item', '.next-and-previous--next--8Avih']
        : ['[data-purpose="go-to-previous"]', '#go-to-previous-item', '.next-and-previous--previous--8Avih'];
    const words = dir === 'next' ? ['next', 'siguiente'] : ['previous', 'prev', 'anterior'];

    let btn: HTMLElement | null = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        btn = el;
        break;
      }
    }
    if (!btn) {
      for (const el of Array.from(document.querySelectorAll('button, [role="button"], a.ud-btn'))) {
        const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
        if (words.some((w) => label.includes(w))) {
          btn = el as HTMLElement;
          break;
        }
      }
    }
    if (!btn) return null;

    const disabled =
      btn.hasAttribute('disabled') ||
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.classList.contains('disabled');
    return disabled ? null : btn;
  }

  static goToNext(timeout = 10000): Promise<{ lectureId: string; changed: boolean }> {
    return this.navigate('next', timeout);
  }

  static goToPrev(timeout = 10000): Promise<{ lectureId: string; changed: boolean }> {
    return this.navigate('prev', timeout);
  }

  /**
   * Navigates directly to a sidebar item by clicking its title (not the checkbox).
   * Returns true once the page is on a new lecture, or if we were already there.
   */
  static async navigateToItem(key: string, timeout = 11000): Promise<boolean> {
    if (this.getCurrentItemKey() === key) return true;

    const item = document.querySelector(`[data-purpose="${key}"]`) as HTMLElement | null;
    if (!item) return false;

    const prevHref = window.location.href;
    const prevId = this.getCurrentLectureId();
    const prevSignature = this.getTranscriptSignature();

    // Click the title text — clicking the checkbox/menu area opens other popups.
    const target = (item.querySelector(SELECTORS.LECTURE_ITEM_TITLE) as HTMLElement | null) || item;
    target.scrollIntoView({ block: 'center' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    item.click();

    const start = Date.now();
    while (Date.now() - start < timeout) {
      const id = this.getCurrentLectureId();
      if (window.location.href !== prevHref || (id && id !== prevId)) {
        await this.waitForFreshLecture(prevSignature, Math.max(2500, timeout - (Date.now() - start)));
        return true;
      }
      await this.sleep(100);
    }
    return false;
  }

  /**
   * Clicks the player's Next/Previous button and waits until the page is on a new
   * lecture (URL changes) and its transcript panel has refreshed. Returns the new
   * lecture id and whether navigation happened (false at the start/end of course).
   */
  private static async navigate(dir: 'next' | 'prev', timeout: number): Promise<{ lectureId: string; changed: boolean }> {
    this.hoverPlayer();
    const prevHref = window.location.href;
    const prevId = this.getCurrentLectureId();
    const prevSignature = this.getTranscriptSignature();

    const btn = this.findNavButton(dir);
    if (!btn) return { lectureId: prevId, changed: false };

    btn.scrollIntoView({ block: 'center' });
    btn.click();
    btn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));

    const start = Date.now();
    while (Date.now() - start < timeout) {
      const id = this.getCurrentLectureId();
      if (window.location.href !== prevHref || (id && id !== prevId)) {
        await this.waitForFreshLecture(prevSignature, Math.max(2500, timeout - (Date.now() - start)));
        return { lectureId: this.getCurrentLectureId(), changed: true };
      }
      await this.sleep(100);
    }
    return { lectureId: this.getCurrentLectureId(), changed: false };
  }

  /**
   * After the URL has changed, waits for the video to be ready and the transcript
   * panel to refresh away from `prevSignature` (so we never read stale content).
   */
  private static async waitForFreshLecture(prevSignature: string, timeout: number): Promise<void> {
    const start = Date.now();
    await this.waitForVideoReady(timeout);
    await this.ensureTranscriptActive();
    while (Date.now() - start < timeout) {
      const sig = this.getTranscriptSignature();
      if (sig && sig !== prevSignature) return;
      await this.sleep(100);
    }
  }

  /** A cheap fingerprint of the currently-rendered transcript cues, to detect staleness. */
  static getTranscriptSignature(): string {
    const panel = document.querySelector(SELECTORS.TRANSCRIPT_PANEL);
    if (!panel) return '';
    const cues = this.findCues(panel);
    if (cues.length === 0) return '';
    return `${cues.length}::${cues[0].textContent?.trim().slice(0, 40) || ''}`;
  }

  // ---------------------------------------------------------------------------
  // Transcript extraction
  // ---------------------------------------------------------------------------

  static isTranscriptAvailable(): boolean {
    if (document.querySelector(SELECTORS.TRANSCRIPT_CUE)) return true;

    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (video?.textTracks) {
      for (const track of Array.from(video.textTracks)) {
        if (track.kind === 'captions' || track.kind === 'subtitles') return true;
      }
    }

    if (this.findTranscriptButton()) return true;
    return !!document.querySelector('[data-purpose="captions-dropdown-button"]');
  }

  static isPageReadyForCollection(): boolean {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    return !!(video && video.readyState >= 2);
  }

  /**
   * Extracts the transcript of the current lecture. Returns the lecture id read from
   * the URL alongside the text so the caller can verify it matches the expected lecture.
   */
  static async extractTranscript(): Promise<TranscriptResult> {
    const lectureId = this.getCurrentLectureId();

    const video = await this.waitForVideoReady(5000);
    if (!video) {
      throw new Error('Video not ready for transcript extraction');
    }

    await this.ensureTranscriptActive();

    // The transcript cues can take a moment to render — wait for them before reading.
    await this.waitForTranscriptContent(2500);

    let parts = this.readTranscriptPanel();
    if (parts.length === 0) {
      parts = await this.extractFromTextTracks();
    }

    if (parts.length === 0) {
      throw new Error('No transcript content found - video may not have captions');
    }

    return { lectureId, transcript: parts.join('\n\n') };
  }

  private static readTranscriptPanel(): string[] {
    const panel = document.querySelector(SELECTORS.TRANSCRIPT_PANEL);
    if (!panel) return [];

    const parts: string[] = [];
    this.findCues(panel).forEach((entry) => {
      const fullText = entry.textContent?.trim() || '';
      if (!fullText || fullText === '...' || fullText.length < 3) return;

      const match = fullText.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)/);
      const timestamp = match ? match[1] : '';
      const text = match ? match[2] : fullText;

      if (text && text.length > 3 && /[a-zA-Z]/.test(text)) {
        // Only prefix a timestamp when we actually found one (no empty "[]").
        parts.push(timestamp ? `[${timestamp}] ${text}` : text);
      }
    });
    return parts;
  }

  private static findCues(panel: Element): Element[] {
    for (const selector of CUE_SELECTORS) {
      const cues = panel.querySelectorAll(selector);
      if (cues.length > 0) return Array.from(cues);
    }
    return [];
  }

  private static async extractFromTextTracks(): Promise<string[]> {
    const lines: string[] = [];
    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (!video?.textTracks?.length) return lines;

    const tracks = Array.from(video.textTracks);
    const track =
      tracks.find((t) => t.kind === 'captions') ||
      tracks.find((t) => t.kind === 'subtitles') ||
      tracks[0];

    track.mode = 'showing';
    await this.waitForCues(track, 2000);

    for (const cue of Array.from(track.cues || []) as VTTCue[]) {
      const text = (cue.text || '').replace(/\s+/g, ' ').trim();
      if (text && text.length > 3) {
        lines.push(`[${this.formatTime(cue.startTime || 0)}] ${text}`);
      }
    }
    return lines;
  }

  private static async ensureTranscriptActive(): Promise<void> {
    const panel = document.querySelector(SELECTORS.TRANSCRIPT_PANEL);
    if (panel && (panel as HTMLElement).offsetParent !== null && panel.querySelector(SELECTORS.TRANSCRIPT_CUE)) {
      return; // already open with content
    }

    // Hover the player so the controls (and the transcript toggle) render.
    const container =
      document.querySelector('[data-purpose="video-display"]') ||
      document.querySelector('.video-js') ||
      document.querySelector('video');
    container?.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: 400, clientY: 300 })
    );

    const button = await this.waitForTranscriptButton(1500);
    if (button) {
      button.click();
      await this.waitForTranscriptContent(1500);
    }
  }

  // ---------------------------------------------------------------------------
  // Small async utilities
  // ---------------------------------------------------------------------------

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static formatTime(totalSeconds: number): string {
    const sec = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    const min = Math.floor((totalSeconds / 60) % 60).toString().padStart(2, '0');
    const hrs = Math.floor(totalSeconds / 3600);
    return hrs > 0 ? `${hrs}:${min}:${sec}` : `${min}:${sec}`;
  }

  private static findTranscriptButton(): HTMLElement | null {
    const selectors = [
      SELECTORS.TRANSCRIPT_TOGGLE,
      '[data-purpose="transcript-toggle"]',
      'button[aria-label*="transcript" i]',
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector) as HTMLElement | null;
      if (btn && btn.offsetParent !== null && !(btn as HTMLButtonElement).disabled) {
        return btn;
      }
    }
    return null;
  }

  private static async waitForVideoReady(timeout: number): Promise<HTMLVideoElement | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (video && video.readyState >= 2) return video;
      await this.sleep(50);
    }
    const video = document.querySelector('video') as HTMLVideoElement | null;
    return video && video.readyState >= 2 ? video : null;
  }

  private static async waitForTranscriptButton(timeout: number): Promise<HTMLElement | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const btn = this.findTranscriptButton();
      if (btn) return btn;
      await this.sleep(50);
    }
    return null;
  }

  private static async waitForTranscriptContent(timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector(SELECTORS.TRANSCRIPT_CUE)) return;
      await this.sleep(50);
    }
  }

  private static async waitForCues(track: TextTrack, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (track.cues && track.cues.length > 0) return;
      await this.sleep(50);
    }
  }
}
