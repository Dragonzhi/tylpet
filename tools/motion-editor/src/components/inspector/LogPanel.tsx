export interface LogPanelProps {
  log: string[];
}

export function LogPanel({ log }: LogPanelProps) {
  return (
    <section className="panel log-section">
      <h2>日志</h2>
      <pre className="log">{log.join("\n") || "等待操作…"}</pre>
    </section>
  );
}
