export default function TokensPage() {
  const swatches = [
    "bg-bg",
    "bg-bg-1",
    "bg-bg-2",
    "bg-bg-3",
    "bg-bg-4",
  ];
  const dots = [
    { name: "green", cls: "bg-green" },
    { name: "amber", cls: "bg-amber" },
    { name: "red", cls: "bg-red" },
    { name: "blue", cls: "bg-blue" },
    { name: "pink", cls: "bg-pink" },
    { name: "teal", cls: "bg-teal" },
  ];

  return (
    <main className="min-h-screen bg-bg text-text p-10 flex flex-col gap-8">
      <h1 className="text-2xl font-serif italic text-accent">Design tokens</h1>

      <section className="flex flex-wrap gap-3">
        {swatches.map((cls) => (
          <div
            key={cls}
            className={`${cls} border border-line w-28 h-20 rounded-md flex items-end p-2`}
          >
            <span className="text-text-3 text-xs font-mono">{cls}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <p className="text-text">text (primary)</p>
        <p className="text-text-2">text-2 (secondary)</p>
        <p className="text-text-3">text-3 (tertiary)</p>
        <p className="text-text-4">text-4 (quaternary)</p>
        <p className="text-accent">text-accent (lavender)</p>
        <p className="text-accent-2">text-accent-2</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="font-mono text-text-2">font-mono: const x = 42; // JetBrains Mono</p>
        <p className="font-serif italic text-2xl text-text">font-serif italic — Instrument Serif</p>
        <p className="font-sans text-text">font-sans — Inter Tight</p>
      </section>

      <section className="flex items-center gap-4">
        {dots.map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <span className={`${d.cls} w-3 h-3 rounded-full inline-block`} />
            <span className="text-text-3 text-xs">{d.name}</span>
          </div>
        ))}
      </section>

      <section className="flex gap-2">
        <span className="border border-line px-3 py-1 rounded">border-line</span>
        <span className="border border-line-2 px-3 py-1 rounded">border-line-2</span>
        <span className="border border-line-strong px-3 py-1 rounded">border-line-strong</span>
      </section>
    </main>
  );
}
