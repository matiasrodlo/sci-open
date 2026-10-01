/**
 * The page's shape while the search runs: the header, the filter column, and
 * a list of works laid out as `ResultCard` lays them — a type line, a title, a
 * byline and two lines of abstract — so nothing jumps when the answer lands.
 */
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-muted ${className}`} />;
}

export function LoadingSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" role="status" aria-label="Loading">
      <Bar className="h-7 w-64" />
      <Bar className="mt-2 h-4 w-40" />

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="min-w-0">
          {/* The folded button on a phone, the column on a wide screen. */}
          <div className="h-10 rounded-lg border lg:hidden" />
          <div className="hidden space-y-6 lg:block">
            <Bar className="h-5 w-20" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2.5 border-t pt-4">
                <Bar className="h-4 w-28" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <Bar className="h-4 w-4" />
                    <Bar className="h-3.5 flex-1" />
                    <Bar className="h-3 w-8" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="h-24 rounded-lg border bg-subtle" />
          <div className="mt-5 flex gap-2 border-b pb-3">
            <Bar className="h-7 w-20" />
            <Bar className="h-7 w-24" />
            <Bar className="h-7 w-20" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b py-5 last:border-b-0">
              <Bar className="h-4 w-4 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bar className="h-3 w-24" />
                <Bar className="h-4 w-4/5" />
                <Bar className="h-4 w-3/5" />
                <Bar className="h-3.5 w-full" />
                <Bar className="h-3.5 w-5/6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
