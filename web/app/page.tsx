"use client";

import { useEffect, useRef, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { History, HistoryEntry, loadHistory, storeHistory } from "@/components/History";
import { Setup } from "@/components/Setup";
import { Uploader } from "@/components/Uploader";
import { runAnalysis } from "@/lib/client";
import { demoTracking } from "@/lib/demo";
import type { AnalysisConfig, Report, TrackingResult } from "@/lib/types";

type Health = { status: string; model?: string };

const DEFAULT_CONFIG: AnalysisConfig = { ourTeam: 0, ourName: "Our team", oppName: "Opponent", ourDirection: "ltr", calibration: null };

export default function Home() {
  const [health, setHealth] = useState<Health>({ status: "checking" });
  const [tracking, setTracking] = useState<TrackingResult | null>(null);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const setupRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
    if (new URLSearchParams(window.location.search).has("demo")) demo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the model service until it's awake (free Spaces sleep when idle).
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const h: Health = await fetch("/api/detect", { cache: "no-store" }).then((r) => r.json());
        if (stop) return;
        setHealth(h);
        timer = setTimeout(check, h.status === "ok" ? 60000 : 10000);
      } catch {
        if (!stop) timer = setTimeout(check, 10000);
      }
    };
    check();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  function onTracking(t: TrackingResult, name: string, file?: File) {
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return file?.type.startsWith("video/") ? URL.createObjectURL(file) : null;
    });
    setTracking(t);
    setReport(null);
    setSavedId(null);
    setError("");
    setConfig((c) => ({ ...c, calibration: null, oppName: c.oppName === "Opponent" && name ? name.slice(0, 40) : c.oppName }));
    setTimeout(() => setupRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function generate(cfg = config, t = tracking) {
    if (!t) return;
    setRunning(true);
    setError("");
    try {
      const calibrationReady = cfg.calibration && cfg.calibration.image.length === 4 ? cfg.calibration : null;
      setReport(await runAnalysis(t, { ...cfg, calibration: calibrationReady }));
      setSavedId(null);
      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setRunning(false);
    }
  }

  function demo() {
    const t = demoTracking();
    setVideoUrl(null);
    // Demo data is already top-down, so an identity calibration (frame corners = pitch corners) is exact.
    const cfg: AnalysisConfig = {
      ...DEFAULT_CONFIG,
      ourName: "Red FC",
      oppName: "White United",
      calibration: { image: [[0, 0], [1, 0], [1, 1], [0, 1]], region: { x0: 0, y0: 0, length: 105, width: 68 } },
    };
    setTracking(t);
    setConfig(cfg);
    generate(cfg, t);
  }

  function save() {
    if (!report) return;
    const entry: HistoryEntry = {
      id: Math.random().toString(36).slice(2),
      savedAt: new Date().toISOString(),
      label: `${report.teams.ours.name} vs ${report.teams.opp.name}`,
      report,
    };
    const next = [entry, ...history];
    if (storeHistory(next)) {
      setHistory(next);
      setSavedId(entry.id);
    } else setError("Couldn't save: browser storage is full or blocked.");
  }

  const pill =
    health.status === "ok"
      ? { text: "YOLOv8 models online", color: "var(--good)" }
      : health.status === "checking"
        ? { text: "Checking model…", color: "var(--text-muted)" }
        : health.status === "error"
          ? { text: "Model failed to load", color: "var(--bad)" }
          : { text: "Model loading…", color: "var(--warn)" };

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-10">
      <header className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Match Prep Analyzer</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink2">
            Upload match footage. YOLOv8 detects and tracks every player and the ball online, and this page turns the tracks into
            possession, shape, pressing and territory insights for your next game.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium" aria-live="polite">
          <span className="h-2 w-2 rounded-full" style={{ background: pill.color }} />
          {pill.text}
        </span>
      </header>

      <div className="no-print">
        <Uploader onTracking={onTracking} onDemo={demo} />
      </div>

      {tracking && (
        <div ref={setupRef} className="no-print scroll-mt-4">
          <Setup tracking={tracking} videoUrl={videoUrl} config={config} onChange={setConfig} onRun={() => generate()} running={running} />
        </div>
      )}

      {error && (
        <p className="card text-sm" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      )}

      {report && (
        <div ref={reportRef} className="scroll-mt-4">
          <Dashboard report={report} onSave={save} saved={!!savedId} />
        </div>
      )}

      <History
        entries={history}
        onOpen={(e) => {
          setReport(e.report);
          setSavedId(e.id);
          setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }}
        onDelete={(id) => {
          const next = history.filter((h) => h.id !== id);
          storeHistory(next);
          setHistory(next);
        }}
      />

      <footer className="no-print pt-4 text-center text-xs text-muted">
        Detection: Ultralytics YOLOv8s (general model for grassroots footage, football-trained model for stadium footage), served as ONNX from Vercel. Only sampled frames leave your device and none are stored.
      </footer>
    </main>
  );
}
