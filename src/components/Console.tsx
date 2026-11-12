import { useEffect, useRef } from 'react';

export interface ConsoleLine {
  text: string;
  stream?: string;
}

interface ConsoleProps {
  lines: ConsoleLine[];
  running?: boolean;
  emptyHint?: string;
  maxHeight?: string;
}

/** Terminal-style output — near-black inset, phosphor text, blinking cursor. */
export function Console({ lines, running, emptyHint = 'no output yet', maxHeight = '420px' }: ConsoleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="panel-inset rounded-md border font-mono text-[12px] leading-relaxed">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="status-dot status-dot--idle" />
        <span className="status-dot status-dot--warn" />
        <span className={`status-dot ${running ? 'status-dot--live' : 'status-dot--idle'}`} />
        <span className="label-tech ml-2">output</span>
        {running && <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-primary">streaming</span>}
      </div>
      <div ref={bodyRef} className="overflow-auto p-3" style={{ maxHeight, minHeight: '120px' }}>
        {lines.length === 0 ? (
          <span className="text-muted-foreground">$ {emptyHint}</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              <span className={l.stream === 'stderr' ? 'text-destructive' : l.text.startsWith('✓') ? 'text-primary text-glow' : l.text.startsWith('ERROR') ? 'text-destructive' : 'text-foreground/90'}>
                {l.text}
              </span>
            </div>
          ))
        )}
        {running && <span className="blink-cursor text-primary">▌</span>}
      </div>
    </div>
  );
}
