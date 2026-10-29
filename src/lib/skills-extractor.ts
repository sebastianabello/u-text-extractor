// Google Skills extractor (partner.skills.google, www.skills.google, cloudskillsboost.google).
//
// Unlike Udemy, nothing here drives the live player. Every activity is read from the
// server-rendered HTML of its own page via same-origin fetch():
//   - video     → the full transcript is embedded in the `transcript` attribute of <ql-youtube-video>
//   - link/doc  → an <ql-iframe> pointing at a Rise course package whose text lives in runtime-data.js
//   - lab/quiz  → not extractable, reported as skipped

export type SkillsPageKind = 'path' | 'course' | 'other';

export interface SkillsContext {
  kind: SkillsPageKind;
  pathId: string; // '' when the page is not inside a learning path
  coursePath: string; // e.g. '/paths/2151/course_templates/972' ('' on a path page)
}

export interface SkillsCard {
  type: string; // video | link | document | lab | quiz | course | ...
  path: string;
  title: string;
  duration: string;
}

export interface SkillsCourse {
  title: string;
  path: string;
  activities: SkillsCard[];
}

export interface SkillsCue {
  time: number;
  text: string;
}

export type SkillsStatus = 'completed' | 'skipped' | 'failed';

export interface SkillsActivityResult {
  status: SkillsStatus;
  kind?: 'transcript' | 'reading';
  cues?: SkillsCue[]; // transcript
  markdown?: string; // reading
  reason?: string;
}

// Card types that carry no extractable content and are not even listed.
const IGNORED_TYPES = new Set(['credential', 'survey']);

const RISE_URL = /^(.*\/)index\.html(?:\?[^#]*)?#\/lessons\/([^/?#]+)/;

// Rise block fields, by role.
const HEAD_KEYS = new Set(['heading', 'title']);
const BODY_KEYS = new Set(['paragraph', 'description', 'text', 'content', 'body', 'quote', 'subtitle', 'label', 'front', 'back', 'answer', 'feedback']);
const SKIP_KEYS = new Set(['id', 'settings', 'style']);

// -----------------------------------------------------------------------------
// HTML → Markdown (small, dependency-free; covers what Rise emits)
// -----------------------------------------------------------------------------

function render(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const kids = () => Array.from(el.childNodes).map((c) => render(c, listDepth)).join('');

  switch (tag) {
    case 'script':
    case 'style':
      return '';
    case 'br':
      return '\n';
    case 'strong':
    case 'b': {
      const t = kids().trim();
      return t ? `**${t}**` : '';
    }
    case 'em':
    case 'i': {
      const t = kids().trim();
      return t ? `*${t}*` : '';
    }
    case 'code': {
      const t = kids().trim();
      return t ? `\`${t}\`` : '';
    }
    case 'a': {
      const t = kids().trim();
      const href = el.getAttribute('href') || '';
      return href && t ? `[${t}](${href})` : t;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n\n${'#'.repeat(Math.min(6, Number(tag[1]) + 3))} ${kids().trim()}\n\n`;
    case 'p':
    case 'div':
      return `\n\n${kids().trim()}\n\n`;
    case 'blockquote':
      return `\n\n${kids().trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
    case 'pre':
      return `\n\n\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`;
    case 'ul':
    case 'ol': {
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
      const lines = items.map((li, i) => {
        const marker = tag === 'ol' ? `${i + 1}.` : '-';
        const body = Array.from(li.childNodes)
          .map((c) => {
            const t = (c as Element).tagName?.toLowerCase();
            return t === 'ul' || t === 'ol' ? `\n${render(c, listDepth + 1).trim()}` : render(c, listDepth);
          })
          .join('')
          .trim();
        return `${'  '.repeat(listDepth)}${marker} ${body}`;
      });
      return `\n\n${lines.join('\n')}\n\n`;
    }
    case 'table': {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.children).map((c) => render(c, listDepth).trim().replace(/\s*\n\s*/g, ' '))
      );
      if (rows.length === 0) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`;
      const sep = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
      return `\n\n${[line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n')}\n\n`;
    }
    default:
      return kids();
  }
}

const tidy = (md: string): string =>
  md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?=\S)(?![-\d>*|#`])/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return tidy(render(doc.body));
}

// -----------------------------------------------------------------------------
// Rise course packages
// -----------------------------------------------------------------------------

const oneLine = (s: string) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

function renderMedia(media: any, out: string[]): void {
  const embed = media?.embed;
  if (embed?.originalUrl) {
    out.push(`- Video: [${oneLine(embed.title || 'Video')}](${embed.originalUrl})`);
  }
}

function walkRise(node: any, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walkRise(n, out));
    return;
  }
  if (!node || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (key === 'media') {
      renderMedia(value, out);
      continue;
    }
    if (SKIP_KEYS.has(key)) continue;

    if (typeof value === 'string') {
      if (!HEAD_KEYS.has(key) && !BODY_KEYS.has(key) && key !== 'caption') continue;
      const md = htmlToMarkdown(value);
      if (!md) continue;
      if (key === 'heading') out.push(`### ${oneLine(md)}`);
      else if (key === 'title') out.push(`#### ${oneLine(md)}`);
      else if (key === 'caption') out.push(`*${oneLine(md)}*`);
      else out.push(md);
    } else {
      walkRise(value, out);
    }
  }
}

export function riseLessonToMarkdown(lesson: any): string {
  const out: string[] = [];
  walkRise(lesson.items || [], out);
  return out.join('\n\n').trim();
}

// Three Rise export layouts exist; all carry the same base64-encoded JSON:
//   newer:  <base>runtime-data.js    →  __jsonp("runtime-data.js", "<base64>")
//   older:  <base>locales/<lang>.js  →  __resolveJsonp("course:<lang>", "<base64>")
//   inline: <base>index.html         →  __fetchCourse() { return ... deserialize("<base64>") }
const RISE_DATA_FILES = ['runtime-data.js', 'locales/und.js', 'locales/en.js', 'index.html'];
const JSONP_PAYLOAD = /__(?:resolveJsonp|jsonp)\(\s*"[^"]+"\s*,\s*"([A-Za-z0-9+/=_-]+)"/;
const INLINE_PAYLOAD = /deserialize\(\s*"([A-Za-z0-9+/=_-]+)"/;

function decodeRiseData(js: string): any {
  const match = js.match(JSONP_PAYLOAD) || js.match(INLINE_PAYLOAD);
  if (!match) throw new Error('Datos del curso con formato desconocido');
  const bin = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// -----------------------------------------------------------------------------
// Extractor
// -----------------------------------------------------------------------------

export class SkillsExtractor {
  private static riseCache = new Map<string, Promise<any>>();

  static isSkillsHost(hostname = window.location.hostname): boolean {
    return /(^|\.)skills\.google$/.test(hostname) || /(^|\.)cloudskillsboost\.google$/.test(hostname);
  }

  static getContext(): SkillsContext {
    const path = window.location.pathname.replace(/\/+$/, '');

    const pathMatch = path.match(/^\/paths\/(\d+)$/);
    if (pathMatch) return { kind: 'path', pathId: pathMatch[1], coursePath: '' };

    const courseMatch = path.match(/^(\/paths\/(\d+))?(\/course_(?:templates|sessions)\/\d+)(?:\/|$)/);
    if (courseMatch) {
      return {
        kind: 'course',
        pathId: courseMatch[2] || '',
        coursePath: `${courseMatch[1] || ''}${courseMatch[3]}`,
      };
    }
    return { kind: 'other', pathId: '', coursePath: '' };
  }

  // ---- fetch helpers --------------------------------------------------------

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static async fetchText(url: string, init?: RequestInit): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.ok) return await res.text();
        lastError = new Error(`HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500) break; // not transient
      } catch (error) {
        lastError = error;
      }
      await this.sleep(500 * (attempt + 1));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private static async fetchDoc(path: string): Promise<Document> {
    const html = await this.fetchText(new URL(path, window.location.origin).toString(), { credentials: 'same-origin' });
    return new DOMParser().parseFromString(html, 'text/html');
  }

  private static cleanTitle(doc: Document): string {
    return (doc.title.split('|')[0] || '').trim();
  }

  private static readCards(doc: Document): SkillsCard[] {
    const attr = (el: Element, name: string) => (el.getAttribute(name) || '').trim();
    return Array.from(doc.querySelectorAll('ql-activity-card')).map((el) => ({
      type: attr(el, 'type'),
      path: attr(el, 'path').split('?')[0],
      title: attr(el, 'name'),
      duration: attr(el, 'duration'),
    }));
  }

  // ---- structure ------------------------------------------------------------

  /** Everything a learning path lists (courses and labs). */
  static async listPath(pathId: string): Promise<SkillsCard[]> {
    const cards = this.readCards(await this.fetchDoc(`/paths/${pathId}`)).filter((c) => c.path);
    if (cards.length === 0) {
      throw new Error('No se encontraron actividades. ¿La sesión de Google Skills sigue iniciada?');
    }
    return cards;
  }

  /** Extractable activities of a course, in order. Credential/survey cards are dropped. */
  static async getCourse(coursePath: string): Promise<SkillsCourse> {
    const doc = await this.fetchDoc(coursePath);
    const activities = this.readCards(doc).filter((c) => !IGNORED_TYPES.has(c.type));
    if (activities.length === 0) {
      throw new Error('No se encontraron actividades. ¿La sesión de Google Skills sigue iniciada?');
    }
    return { title: this.cleanTitle(doc) || coursePath, path: coursePath, activities };
  }

  // ---- content --------------------------------------------------------------

  static async extractActivity(card: SkillsCard): Promise<SkillsActivityResult> {
    try {
      switch (card.type) {
        case 'video':
          return await this.extractVideo(card.path);
        case 'link':
        case 'document':
          return await this.extractDocument(card.path);
        default:
          return { status: 'skipped', reason: `Tipo "${card.type}" no extraíble (solo videos y lecturas)` };
      }
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private static async extractVideo(path: string): Promise<SkillsActivityResult> {
    const doc = await this.fetchDoc(path);
    const raw = doc.querySelector('ql-youtube-video')?.getAttribute('transcript');
    if (!raw) return { status: 'skipped', reason: 'El video no trae transcripción' };

    const parsed = JSON.parse(raw) as Array<{ time?: number; text?: string }>;
    const cues = parsed
      .map((c) => ({ time: Number(c.time) || 0, text: (c.text || '').replace(/\s+/g, ' ').trim() }))
      .filter((c) => c.text);
    if (cues.length === 0) return { status: 'skipped', reason: 'La transcripción está vacía' };
    return { status: 'completed', kind: 'transcript', cues };
  }

  private static loadRise(base: string): Promise<any> {
    let cached = this.riseCache.get(base);
    if (!cached) {
      cached = this.fetchRiseData(base);
      cached.catch(() => this.riseCache.delete(base)); // don't cache failures
      this.riseCache.set(base, cached);
    }
    return cached;
  }

  private static async fetchRiseData(base: string): Promise<any> {
    for (const file of RISE_DATA_FILES) {
      let js: string;
      try {
        js = await this.fetchText(`${base}${file}`);
      } catch {
        continue; // this layout isn't the one used by the package
      }
      return decodeRiseData(js);
    }
    throw new Error('No se encontraron los datos del curso en el paquete');
  }

  private static async extractDocument(path: string): Promise<SkillsActivityResult> {
    const doc = await this.fetchDoc(path);
    const src = doc.querySelector('ql-iframe')?.getAttribute('src') || '';

    const rise = src.match(RISE_URL);
    if (rise) {
      const data = await this.loadRise(rise[1]);
      const lesson = (data.course?.lessons || []).find((l: any) => l.id === rise[2]);
      if (!lesson) throw new Error('La lección no existe en el paquete del curso');
      const markdown = riseLessonToMarkdown(lesson);
      if (!markdown) return { status: 'skipped', reason: 'La lección no tiene texto' };
      return { status: 'completed', kind: 'reading', markdown };
    }

    // Not a Rise lesson: either another embedded page or a downloadable file
    // (glossaries and handouts are plain <iframe>s over a Cloud Storage object).
    const fileUrl = src || doc.querySelector('iframe[src*="storage.googleapis.com"]')?.getAttribute('src') || '';
    if (!fileUrl) return { status: 'skipped', reason: 'La lectura no tiene contenido embebido' };

    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/html|text\/plain/.test(type)) {
      return { status: 'skipped', reason: `Archivo descargable (${type || 'tipo desconocido'}) no soportado: ${fileUrl}` };
    }
    const text = await res.text();
    const markdown = /html/.test(type)
      ? tidy(render(new DOMParser().parseFromString(text, 'text/html').body))
      : text.trim();
    if (!markdown) return { status: 'skipped', reason: 'Formato de lectura no soportado' };
    return { status: 'completed', kind: 'reading', markdown };
  }
}
