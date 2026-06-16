"use client";

import { useState, useEffect, useRef } from 'react';
import {
  Sun, Moon, Copy, Check, Download, Loader2, FileText, FolderDown,
  RotateCcw, AlertCircle, X, Layers, ChevronLeft, Play, Info,
} from 'lucide-react';
import JSZip from 'jszip';

const getExt = async () => (await import('../../lib/extension-service')).ExtensionService;

type ExportFormat = 'txt' | 'markdown' | 'json' | 'rag';
type BulkStatus = 'completed' | 'failed' | 'skipped';
interface BulkResult { key: string; title: string; transcript: string | null; status: BulkStatus }

const FORMAT_EXT: Record<ExportFormat, string> = { txt: 'txt', markdown: 'md', json: 'json', rag: 'json' };

const safeName = (title: string) =>
  title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'transcript';

const friendlyError = (e?: string): string => {
  if (!e) return 'Algo salió mal. Inténtalo de nuevo.';
  if (/no transcript|captions/i.test(e)) return 'Esta lección no tiene subtítulos disponibles.';
  if (/not ready|video/i.test(e)) return 'El video aún se está cargando. Espera un momento.';
  if (/connect|refresh|receiving end/i.test(e)) return 'Recarga la página de Udemy e inténtalo otra vez.';
  return e;
};

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

const STATUS_STYLE: Record<BulkStatus, { color: string; icon: string; label: string }> = {
  completed: { color: 'text-emerald-600 dark:text-emerald-400', icon: '✓', label: 'Extraída' },
  skipped: { color: 'text-neutral-400', icon: '–', label: 'Saltada' },
  failed: { color: 'text-red-500', icon: '✗', label: 'Falló' },
};

export const TranscriptExtractorPopup = () => {
  const [dark, setDark] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [includeTs, setIncludeTs] = useState(true);

  const [onCourse, setOnCourse] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(false);
  const [currentTitle, setCurrentTitle] = useState('');
  const [openVideoCount, setOpenVideoCount] = useState(0);

  const [view, setView] = useState<'home' | 'single' | 'bulk'>('home');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [single, setSingle] = useState('');

  const [bulkStatus, setBulkStatus] = useState<'idle' | 'running' | 'done' | 'cancelled'>('idle');
  const [results, setResults] = useState<BulkResult[]>([]);
  const [bulkCurrent, setBulkCurrent] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkNow, setBulkNow] = useState('');
  const cancelRef = useRef(false);

  // ---- init -----------------------------------------------------------------
  useEffect(() => {
    const savedTheme = localStorage.getItem('ute-theme');
    const prefersDark = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(prefersDark);
    document.documentElement.classList.toggle('dark', prefersDark);

    const savedFormat = localStorage.getItem('ute-format') as ExportFormat | null;
    if (savedFormat) setFormat(savedFormat);

    detect();
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('ute-theme', next ? 'dark' : 'light');
  };

  const changeFormat = (f: ExportFormat) => {
    setFormat(f);
    localStorage.setItem('ute-format', f);
  };

  const detect = async () => {
    try {
      const Ext = await getExt();
      const avail = await Ext.checkAvailability();
      if (!avail.success || !avail.data) {
        setOnCourse(false);
        return;
      }
      setOnCourse(avail.data.isCoursePage);
      setAvailable(avail.data.hasTranscript);
      if (!avail.data.isCoursePage) return;

      const meta = await Ext.getLectureMeta();
      if (meta.success && meta.data) setCurrentTitle(meta.data.title);

      const open = await Ext.getOpenItems();
      if (open.success && open.data) setOpenVideoCount(open.data.filter((i) => i.isVideo).length);
    } catch {
      setOnCourse(false);
    }
  };

  const flash = (kind: 'info' | 'error' | 'success', text: string, ms = 2500) => {
    setMessage({ kind, text });
    if (ms) setTimeout(() => setMessage(null), ms);
  };

  // ---- single ---------------------------------------------------------------
  const extractCurrent = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const Ext = await getExt();
      const res = await Ext.extractTranscript();
      if (res.success && res.data?.transcript) {
        setSingle(res.data.transcript);
        setView('single');
      } else {
        flash('error', friendlyError(res.error), 4000);
      }
    } catch (e) {
      flash('error', friendlyError(e instanceof Error ? e.message : undefined), 4000);
    } finally {
      setBusy(false);
    }
  };

  const extractNext = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const Ext = await getExt();
      const nav = await Ext.goToNext();
      if (!nav.success || !nav.data?.changed) {
        flash('info', 'No hay una lección siguiente.');
        return;
      }
      const res = await Ext.extractTranscript();
      if (res.success && res.data?.transcript) {
        setSingle(res.data.transcript);
        await detect();
      } else {
        flash('error', friendlyError(res.error), 4000);
      }
    } catch (e) {
      flash('error', friendlyError(e instanceof Error ? e.message : undefined), 4000);
    } finally {
      setBusy(false);
    }
  };

  const copySingle = async () => {
    const Ext = await getExt();
    const text = Ext.formatTranscript(single, format, includeTs, currentTitle);
    if (await Ext.copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      flash('error', 'No se pudo copiar.');
    }
  };

  const downloadSingle = async () => {
    const Ext = await getExt();
    const text = Ext.formatTranscript(single, format, includeTs, currentTitle);
    triggerDownload(new Blob([text], { type: 'text/plain' }), `${safeName(currentTitle)}.${FORMAT_EXT[format]}`);
  };

  // ---- bulk (open sections) -------------------------------------------------
  const runOpenSections = async (reuse?: Map<string, BulkResult>) => {
    cancelRef.current = false;
    setView('bulk');
    setBulkStatus('running');
    setBulkNow('');
    setMessage(null);

    const Ext = await getExt();
    const openRes = await Ext.getOpenItems();
    const open = openRes.success ? openRes.data || [] : [];
    if (open.length === 0) {
      setBulkStatus('idle');
      setView('home');
      flash('error', 'Expande en Udemy las secciones que quieras extraer.', 5000);
      return;
    }

    const openKeys = new Set(open.map((i) => i.key));
    setBulkTotal(open.length);
    setResults([]);
    setBulkCurrent(0);

    // Phase A: move to the first item of the open sections, so we extract the whole
    // section even if we started in the middle. Prefer a direct click on the first
    // item; fall back to walking back with the "Previous" button.
    let idx = open.findIndex((i) => i.isCurrent);
    if (idx < 0) idx = 0;
    if (idx > 0 && !cancelRef.current) {
      setBulkNow(open[0].title);
      const jumped = await Ext.goToItem(open[0].key);
      if (jumped.success && jumped.data) {
        idx = 0;
      } else {
        while (idx > 0 && !cancelRef.current) {
          const prev = await Ext.goToPrev();
          if (!prev.success || !prev.data?.changed) break;
          const m = await Ext.getLectureMeta();
          const k = m.success ? m.data?.currentKey || '' : '';
          const found = k ? open.findIndex((i) => i.key === k) : -1;
          idx = found >= 0 ? found : idx - 1;
          if (found === 0) break;
        }
      }
    }

    // Phase B: extract forward through the open items.
    const collected: BulkResult[] = [];
    const seen = new Set<string>();

    for (let guard = 0; guard < 1000 && !cancelRef.current; guard++) {
      const metaRes = await Ext.getLectureMeta();
      const key = metaRes.success ? metaRes.data?.currentKey || '' : '';
      const lectureId = metaRes.success ? metaRes.data?.lectureId || '' : '';

      // Re-sync the index from the live page when possible (handles drift).
      if (key) {
        const found = open.findIndex((i) => i.key === key);
        if (found < 0) break; // left the open sections
        idx = found;
      }
      if (idx >= open.length) break;

      const item = open[idx];
      const title = item?.title || `Lección ${idx + 1}`;
      const itemKey = item?.key || key || `idx-${idx}`;
      if (seen.has(itemKey)) break;
      seen.add(itemKey);
      setBulkNow(title);

      const prior = reuse?.get(itemKey);
      if (prior && prior.status === 'completed') {
        collected.push(prior);
      } else if (item && !item.isVideo) {
        collected.push({ key: itemKey, title, transcript: null, status: 'skipped' });
      } else {
        collected.push({ key: itemKey, title, ...(await extractWithRetry(Ext, lectureId)) });
      }

      setBulkCurrent(collected.length);
      setResults([...collected]);

      if (idx >= open.length - 1 || cancelRef.current) break;
      const nav = await Ext.goToNext();
      if (!nav.success || !nav.data?.changed) break;
      idx += 1; // advance; the next iteration re-syncs from the live page if it can
    }

    setBulkStatus(cancelRef.current ? 'cancelled' : 'done');
    setBulkNow('');
  };

  // Extract the current lecture, retrying once if it failed for a non-caption reason
  // (e.g. the transcript was still loading).
  const extractWithRetry = async (
    Ext: Awaited<ReturnType<typeof getExt>>,
    lectureId: string
  ): Promise<{ transcript: string | null; status: BulkStatus }> => {
    if (!lectureId) return { transcript: null, status: 'skipped' };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await Ext.extractTranscript();
        if (r.success && r.data?.transcript) return { transcript: r.data.transcript, status: 'completed' };
        if (/no transcript|captions/i.test(r.error || '')) return { transcript: null, status: 'skipped' };
      } catch (e) {
        if (/no transcript|captions/i.test(e instanceof Error ? e.message : '')) {
          return { transcript: null, status: 'skipped' };
        }
      }
      if (attempt === 0) await new Promise((res) => setTimeout(res, 1200));
    }
    return { transcript: null, status: 'failed' };
  };

  const retryFailed = () => {
    const reuse = new Map(results.filter((r) => r.status === 'completed').map((r) => [r.key, r]));
    runOpenSections(reuse);
  };

  const downloadZip = async () => {
    const Ext = await getExt();
    const done = results.filter((r) => r.status === 'completed' && r.transcript);
    if (done.length === 0) return;
    const zip = new JSZip();
    done.forEach((r, i) => {
      const content = Ext.formatTranscript(r.transcript!, format, includeTs, r.title);
      zip.file(`${String(i + 1).padStart(2, '0')}-${safeName(r.title)}.${FORMAT_EXT[format]}`, content);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `transcripts-${new Date().toISOString().slice(0, 10)}.zip`);
  };

  const copyAll = async () => {
    const Ext = await getExt();
    const done = results.filter((r) => r.status === 'completed' && r.transcript);
    const text = done
      .map((r) => `# ${r.title}\n\n${Ext.formatTranscript(r.transcript!, format, includeTs, r.title)}`)
      .join('\n\n\n');
    if (await Ext.copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // ---- derived --------------------------------------------------------------
  const done = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const percent = bulkTotal > 0 ? Math.min(100, Math.round((bulkCurrent / bulkTotal) * 100)) : 0;

  // ---- small UI helpers -----------------------------------------------------
  const card = 'rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900';
  const primaryBtn =
    'w-full inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium px-4 py-2.5 transition-colors hover:bg-neutral-800 dark:hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed';
  const ghostBtn =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm font-medium px-4 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40';

  const formatPicker = (
    <div className="flex items-center gap-2">
      <select
        value={format}
        onChange={(e) => changeFormat(e.target.value as ExportFormat)}
        className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm px-2.5 py-2 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
      >
        <option value="txt">Texto (.txt)</option>
        <option value="markdown">Markdown (.md)</option>
        <option value="json">JSON (.json)</option>
        <option value="rag">RAG (.json)</option>
      </select>
      <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none cursor-pointer whitespace-nowrap">
        <input type="checkbox" checked={includeTs} onChange={(e) => setIncludeTs(e.target.checked)} className="accent-neutral-900 dark:accent-white" />
        Marcas de tiempo
      </label>
    </div>
  );

  const resultRow = (r: BulkResult, i: number) => (
    <div key={i} className="flex items-center gap-2 py-1">
      <span className={`text-xs w-3 flex-shrink-0 ${STATUS_STYLE[r.status].color}`}>{STATUS_STYLE[r.status].icon}</span>
      <span className="text-xs text-neutral-600 dark:text-neutral-300 truncate flex-1">{r.title}</span>
    </div>
  );

  return (
    <div className="w-[380px] h-[540px] flex flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-neutral-900 dark:bg-white flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-white dark:text-neutral-900" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Transcript Extractor</span>
        </div>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label={dark ? 'Modo claro' : 'Modo oscuro'}
        >
          {dark ? <Sun className="w-4 h-4 text-neutral-400" /> : <Moon className="w-4 h-4 text-neutral-500" />}
        </button>
      </header>

      {/* Message banner */}
      {message && (
        <div
          className={`flex items-start gap-2 px-4 py-2 text-xs border-b ${
            message.kind === 'error'
              ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-100 dark:border-red-900/50'
              : message.kind === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50'
                : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {/* Body */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Not on a course */}
        {onCourse === false && (
          <div className={`${card} p-5 text-center`}>
            <Info className="w-5 h-5 mx-auto mb-2 text-neutral-400" />
            <p className="text-sm font-medium">Abre una lección de Udemy</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Ve a un curso y entra en una lección con video para empezar.
            </p>
          </div>
        )}

        {/* HOME */}
        {onCourse && view === 'home' && (
          <>
            <div className={`${card} p-4`}>
              <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">Lección actual</p>
              <p className="text-sm font-medium leading-snug mb-3 line-clamp-2">{currentTitle || 'Cargando…'}</p>
              <button onClick={extractCurrent} disabled={busy || !available} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Extraer esta lección
              </button>
              {!available && (
                <p className="text-xs text-neutral-400 mt-2 text-center">No se detectaron subtítulos en esta lección.</p>
              )}
            </div>

            <div className={`${card} p-4`}>
              <div className="flex items-center gap-2 mb-1">
                <Layers className="w-4 h-4 text-neutral-400" />
                <p className="text-sm font-medium">Extraer secciones abiertas</p>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
                {openVideoCount > 0
                  ? `${openVideoCount} ${openVideoCount === 1 ? 'video' : 'videos'} en las secciones que tienes expandidas.`
                  : 'Expande en la barra lateral de Udemy las secciones que quieras extraer.'}
              </p>
              <button onClick={() => runOpenSections()} disabled={busy} className={ghostBtn + ' w-full'}>
                <Layers className="w-4 h-4" />
                Extraer {openVideoCount > 0 ? `(${openVideoCount})` : 'secciones abiertas'}
              </button>
              <p className="text-[11px] text-neutral-400 mt-2 text-center">Mantén este panel abierto durante el proceso.</p>
            </div>
          </>
        )}

        {/* SINGLE result */}
        {view === 'single' && (
          <div className="space-y-3">
            <button onClick={() => setView('home')} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver
            </button>
            <p className="text-sm font-medium leading-snug line-clamp-2">{currentTitle}</p>
            <textarea
              value={single}
              onChange={(e) => setSingle(e.target.value)}
              spellCheck={false}
              className="w-full h-56 resize-none rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs leading-relaxed font-mono text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
            />
            {formatPicker}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={copySingle} className={ghostBtn}>
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
              <button onClick={downloadSingle} className={ghostBtn}>
                <Download className="w-4 h-4" /> Descargar
              </button>
            </div>
            <button onClick={extractNext} disabled={busy} className={primaryBtn}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Extraer siguiente lección
            </button>
          </div>
        )}

        {/* BULK */}
        {view === 'bulk' && (
          <div className="space-y-3">
            {bulkStatus === 'running' ? (
              <div className={`${card} p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                    <span className="text-sm font-medium">Extrayendo…</span>
                  </div>
                  <button onClick={() => (cancelRef.current = true)} className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600">
                    <X className="w-3 h-3" /> Cancelar
                  </button>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden mb-2">
                  <div className="h-full bg-neutral-900 dark:bg-white transition-all duration-300" style={{ width: `${percent}%` }} />
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {bulkCurrent} de ~{Math.max(bulkTotal, bulkCurrent)} · <span className="truncate">{bulkNow}</span>
                </p>
              </div>
            ) : (
              <div className={`${card} p-4`}>
                <p className="text-sm font-medium mb-1">
                  {bulkStatus === 'cancelled' ? 'Extracción cancelada' : 'Extracción completa'}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
                  {done} extraídas{skipped > 0 ? ` · ${skipped} saltadas` : ''}{failed > 0 ? ` · ${failed} fallaron` : ''}
                </p>

                {done > 0 && (
                  <>
                    {formatPicker}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button onClick={downloadZip} className={primaryBtn}>
                        <FolderDown className="w-4 h-4" /> Descargar ZIP
                      </button>
                      <button onClick={copyAll} className={ghostBtn}>
                        {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'Copiado' : 'Copiar todo'}
                      </button>
                    </div>
                  </>
                )}

                <div className="flex gap-2 mt-2">
                  {failed > 0 && (
                    <button onClick={retryFailed} className={ghostBtn + ' flex-1'}>
                      <RotateCcw className="w-4 h-4" /> Reintentar fallidas
                    </button>
                  )}
                  <button onClick={() => { setView('home'); setBulkStatus('idle'); setResults([]); }} className={ghostBtn + ' flex-1'}>
                    Volver
                  </button>
                </div>
                {failed > 0 && (
                  <p className="text-[11px] text-neutral-400 mt-2">
                    Para reintentar, vuelve a la primera lección de las secciones abiertas y pulsa “Reintentar”.
                  </p>
                )}
              </div>
            )}

            {results.length > 0 && (
              <div className={`${card} p-3`}>
                <p className="text-xs font-medium text-neutral-400 mb-1">Lecciones ({results.length})</p>
                <div className="max-h-44 overflow-y-auto pr-1">{results.map(resultRow)}</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-center gap-3 px-4 h-9 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-400 flex-shrink-0">
        <span>Local-first</span>
        <span>·</span>
        <span>Solo Udemy</span>
      </footer>
    </div>
  );
};
