/**
 * The page's shape while the search runs: the filter column, the header, and
 * a list of works laid out as `ResultCard` lays them — a type line, a title, a
 * byline and two lines of abstract — so nothing jumps when the answer lands.
 */
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-muted ${className}`} />;
}

export function LoadingSkeleton() {
  return (
    <div
      className="grid animate-pulse grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[15rem_minmax(0,1fr)]"
      role="status"
      aria-label="Loading"
    >
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <Bar className="h-7 w-64" />
        <Bar className="mt-2 h-4 w-40" />
        <div className="mt-5 h-24 rounded-lg border bg-subtle" />
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

      <div className="hidden min-w-0 space-y-6 lg:col-start-1 lg:row-start-1 lg:block">
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
  );
}
