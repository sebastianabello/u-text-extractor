"use client";

import { useState, useEffect, useRef } from 'react';
import { Loader2, FolderDown, RotateCcw, X, Info, Layers, Route } from 'lucide-react';
import JSZip from 'jszip';
import { formatCues } from '../../lib/skills-format';
import type { SkillsActivityResult, SkillsCard, SkillsContext, SkillsStatus } from '../../lib/skills-extractor';

const getExt = async () => (await import('../../lib/extension-service')).ExtensionService;

interface Row {
  courseIndex: number;
  courseTitle: string;
  index: number; // 1-based position inside the course
  card: SkillsCard;
  status: SkillsStatus;
  result?: SkillsActivityResult;
  reason?: string;
}

const safeName = (title: string) =>
  title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'untitled';

const pad = (n: number) => String(n).padStart(2, '0');

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const STATUS_STYLE: Record<SkillsStatus, { color: string; icon: string }> = {
  completed: { color: 'text-emerald-600 dark:text-emerald-400', icon: '✓' },
  skipped: { color: 'text-neutral-400', icon: '–' },
  failed: { color: 'text-red-500', icon: '✗' },
};

const card = 'rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900';
const primaryBtn =
  'w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium px-4 py-2.5 transition-colors hover:bg-neutral-800 dark:hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed';
const ghostBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm font-medium px-4 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40';

export const SkillsPanel = ({ ctx }: { ctx: SkillsContext }) => {
  const [includeTs, setIncludeTs] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [pathCourseCount, setPathCourseCount] = useState<number | null>(null);

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'cancelled'>('idle');
  const [scope, setScope] = useState<'course' | 'path'>('course');
  const [rows, setRows] = useState<Row[]>([]);
  const [now, setNow] = useState('');
  const [error, setError] = useState('');
  const cancelRef = useRef(false);

  // Titles / counts shown on the home view.
  useEffect(() => {
    (async () => {
      const Ext = await getExt();
      if (ctx.kind === 'course') {
        const res = await Ext.skillsGetCourse(ctx.coursePath);
        if (res.success && res.data) setCourseTitle(res.data.title);
      }
      if (ctx.pathId) {
        const res = await Ext.skillsListPath(ctx.pathId);
        if (res.success && res.data) setPathCourseCount(res.data.filter((c) => c.type === 'course').length);
      }
    })().catch(() => undefined);
  }, [ctx.kind, ctx.coursePath, ctx.pathId]);

  const run = async (nextScope: 'course' | 'path') => {
    cancelRef.current = false;
    setScope(nextScope);
    setStatus('running');
    setRows([]);
    setError('');
    setNow('');

    const Ext = await getExt();
    const collected: Row[] = [];
    const publish = () => setRows([...collected]);

    let courses: { title: string; path: string }[];
    if (nextScope === 'path') {
      const list = await Ext.skillsListPath(ctx.pathId);
      if (!list.success || !list.data) {
        setError(list.error || 'No se pudo leer la ruta.');
        setStatus('idle');
        return;
      }
      courses = list.data.filter((c) => c.type === 'course').map((c) => ({ title: c.title, path: c.path }));
      // Labs and other non-course entries are reported, never extracted.
      list.data
        .filter((c) => c.type !== 'course')
        .forEach((c) =>
          collected.push({
            courseIndex: 0,
            courseTitle: 'Ruta',
            index: collected.length + 1,
            card: c,
            status: 'skipped',
            reason: `Tipo "${c.type}" no extraíble`,
          })
        );
    } else {
      courses = [{ title: courseTitle, path: ctx.coursePath }];
    }

    for (let ci = 0; ci < courses.length && !cancelRef.current; ci++) {
      const course = await Ext.skillsGetCourse(courses[ci].path);
      if (!course.success || !course.data) {
        // Retired ([Deprecated]) courses stay listed in the path but answer 403.
        const forbidden = course.error === 'HTTP 403';
        collected.push({
          courseIndex: ci + 1,
          courseTitle: courses[ci].title,
          index: 0,
          card: { type: 'course', path: courses[ci].path, title: courses[ci].title, duration: '' },
          status: forbidden ? 'skipped' : 'failed',
          reason: forbidden ? 'Curso sin acceso (HTTP 403), probablemente retirado' : course.error || 'No se pudo leer el curso',
        });
        publish();
        continue;
      }

      const title = course.data.title;
      for (let i = 0; i < course.data.activities.length && !cancelRef.current; i++) {
        const activity = course.data.activities[i];
        setNow(`${title} · ${activity.title}`);
        const res = await Ext.skillsExtractActivity(activity);
        const result = res.success ? res.data : undefined;
        collected.push({
          courseIndex: ci + 1,
          courseTitle: title,
          index: i + 1,
          card: activity,
          status: result?.status ?? 'failed',
          result,
          reason: result?.reason || res.error,
        });
        publish();
        await sleep(150);
      }
    }

    setStatus(cancelRef.current ? 'cancelled' : 'done');
    setNow('');
  };

  const retryFailed = async () => {
    const Ext = await getExt();
    cancelRef.current = false;
    setStatus('running');
    const next = [...rows];
    for (let i = 0; i < next.length && !cancelRef.current; i++) {
      if (next[i].status !== 'failed' || next[i].index === 0) continue;
      setNow(`${next[i].courseTitle} · ${next[i].card.title}`);
      const res = await Ext.skillsExtractActivity(next[i].card);
      const result = res.success ? res.data : undefined;
      next[i] = { ...next[i], status: result?.status ?? 'failed', result, reason: result?.reason || res.error };
      setRows([...next]);
      await sleep(150);
    }
    setStatus(cancelRef.current ? 'cancelled' : 'done');
    setNow('');
  };

  const bodyOf = (r: Row): string | null => {
    if (r.status !== 'completed' || !r.result) return null;
    if (r.result.kind === 'transcript' && r.result.cues) {
      return `# Transcript\n\n${formatCues(r.result.cues, includeTs)}\n`;
    }
    if (r.result.kind === 'reading' && r.result.markdown) {
      return `# Reading\n\n${r.result.markdown}\n`;
    }
    return null;
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const byCourse = new Map<number, Row[]>();
    rows.forEach((r) => byCourse.set(r.courseIndex, [...(byCourse.get(r.courseIndex) || []), r]));

    const manifest = {
      generated: new Date().toISOString(),
      scope,
      courses: [] as unknown[],
    };

    byCourse.forEach((courseRows, courseIndex) => {
      const first = courseRows[0];
      const folder = scope === 'path' && courseIndex > 0
        ? `${pad(courseIndex)}-${safeName(first.courseTitle)}`
        : safeName(first.courseTitle);

      const activities = courseRows.map((r) => {
        const body = bodyOf(r);
        const file = body ? `${folder}/${pad(r.index)}-${safeName(r.card.title)}.md` : null;
        if (body && file) zip.file(file, body);
        return { n: r.index, title: r.card.title, type: r.card.type, status: r.status, reason: r.reason ?? null, file };
      });
      manifest.courses.push({ title: first.courseTitle, folder, activities });
    });

    zip.file('_manifest.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const name = scope === 'path' ? `skills-path-${ctx.pathId}` : `skills-${safeName(courseTitle || 'course')}`;
    triggerDownload(blob, `${name}-${new Date().toISOString().slice(0, 10)}.zip`);
  };

  // ---- derived --------------------------------------------------------------
  const done = rows.filter((r) => r.status === 'completed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  // ---- render ---------------------------------------------------------------
  if (ctx.kind === 'other') {
    return (
      <div className={`${card} p-5 text-center`}>
        <Info className="w-5 h-5 mx-auto mb-2 text-neutral-400" />
        <p className="text-sm font-medium">Abre una ruta o un curso de Google Skills</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          Funciona en páginas como /paths/&lt;id&gt; o /course_templates/&lt;id&gt;.
        </p>
      </div>
    );
  }

  if (status !== 'idle') {
    return (
      <div className="space-y-3">
        {status === 'running' ? (
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                <span className="text-sm font-medium">Extrayendo…</span>
              </div>
              <button onClick={() => (cancelRef.current = true)} className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600">
                <X className="w-3 h-3" /> Cancelar
              </button>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{now || '…'}</p>
            <p className="text-[11px] text-neutral-400 mt-1">{rows.length} actividades procesadas · Mantén este panel abierto.</p>
          </div>
        ) : (
          <div className={`${card} p-4`}>
            <p className="text-sm font-medium mb-1">
              {status === 'cancelled' ? 'Extracción cancelada' : 'Extracción completa'}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
              {done} extraídas · {skipped} saltadas{failed > 0 ? ` · ${failed} fallaron` : ''}
            </p>
            <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none cursor-pointer mb-3">
              <input type="checkbox" checked={includeTs} onChange={(e) => setIncludeTs(e.target.checked)} className="accent-neutral-900 dark:accent-white" />
              Marcas de tiempo en transcripciones
            </label>
            {done > 0 && (
              <button onClick={downloadZip} className={primaryBtn}>
                <FolderDown className="w-4 h-4" /> Descargar ZIP (.md por actividad)
              </button>
            )}
            <div className="flex gap-2 mt-2">
              {failed > 0 && (
                <button onClick={retryFailed} className={ghostBtn + ' flex-1'}>
                  <RotateCcw className="w-4 h-4" /> Reintentar fallidas
                </button>
              )}
              <button onClick={() => { setStatus('idle'); setRows([]); }} className={ghostBtn + ' flex-1'}>
                Volver
              </button>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className={`${card} p-3`}>
            <p className="text-xs font-medium text-neutral-400 mb-1">Actividades ({rows.length})</p>
            <div className="max-h-44 overflow-y-auto pr-1">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 py-1" title={r.reason || ''}>
                  <span className={`text-xs w-3 flex-shrink-0 ${STATUS_STYLE[r.status].color}`}>{STATUS_STYLE[r.status].icon}</span>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300 truncate flex-1">
                    {scope === 'path' ? `${r.courseTitle} · ` : ''}{r.card.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {error && <p className="text-xs text-red-500">{error}</p>}

      {ctx.kind === 'course' && (
        <div className={`${card} p-4`}>
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">Curso actual</p>
          <p className="text-sm font-medium leading-snug mb-3 line-clamp-2">{courseTitle || 'Cargando…'}</p>
          <button onClick={() => run('course')} disabled={!courseTitle} className={primaryBtn}>
            <Layers className="w-4 h-4" /> Extraer este curso
          </button>
          <p className="text-[11px] text-neutral-400 mt-2 text-center">Videos (transcripción) y lecturas. Labs y quizzes se saltan.</p>
          <p className="text-[11px] text-neutral-400 mt-1 text-center">Abrir las lecturas inicia el curso en Google Skills (0 % de avance).</p>
        </div>
      )}

      {ctx.pathId && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-2 mb-1">
            <Route className="w-4 h-4 text-neutral-400" />
            <p className="text-sm font-medium">Toda la ruta</p>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
            {pathCourseCount !== null
              ? `${pathCourseCount} cursos. Un ZIP con una carpeta por curso.`
              : 'Leyendo la ruta…'}
          </p>
          <button onClick={() => run('path')} disabled={pathCourseCount === null} className={ctx.kind === 'path' ? primaryBtn : ghostBtn + ' w-full'}>
            <Route className="w-4 h-4" /> Extraer ruta completa
          </button>
        </div>
      )}
    </>
  );
};
