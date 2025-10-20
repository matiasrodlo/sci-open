import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header Skeleton */}
      <div className="bg-gradient-to-r from-muted/20 via-muted/30 to-muted/20 rounded-2xl p-8 border border-muted/50 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-muted/50 rounded-xl"></div>
              <div className="h-8 w-48 bg-muted/50 rounded-lg"></div>
            </div>
            <div className="h-6 w-96 bg-muted/50 rounded-lg"></div>
            <div className="h-4 w-64 bg-muted/50 rounded-lg"></div>
          </div>
          <div className="text-right space-y-2">
            <div className="h-8 w-20 bg-muted/50 rounded-lg"></div>
            <div className="h-4 w-24 bg-muted/50 rounded-lg"></div>
          </div>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Facet Panel Skeleton */}
        <div className="w-64 space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 w-24 bg-muted/50 rounded"></div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex items-center space-x-2">
                    <div className="h-4 w-4 bg-muted/50 rounded"></div>
                    <div className="h-4 w-20 bg-muted/50 rounded"></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Results Skeleton */}
        <div className="flex-1 space-y-6">
          {/* Sort Bar Skeleton */}
          <div className="flex items-center justify-between p-4 bg-muted/20 rounded-lg animate-pulse">
            <div className="h-4 w-16 bg-muted/50 rounded"></div>
            <div className="flex gap-2">
              <div className="h-8 w-20 bg-muted/50 rounded"></div>
              <div className="h-8 w-16 bg-muted/50 rounded"></div>
              <div className="h-8 w-20 bg-muted/50 rounded"></div>
            </div>
          </div>

          {/* Result Cards Skeleton */}
          <div className="space-y-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="animate-pulse border-2">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1 space-y-3">
                      <div className="h-6 bg-muted/50 rounded w-4/5"></div>
                      <div className="h-4 bg-muted/50 rounded w-3/5"></div>
                      <div className="flex gap-3">
                        <div className="h-4 w-24 bg-muted/50 rounded"></div>
                        <div className="h-4 w-12 bg-muted/50 rounded"></div>
                        <div className="h-4 w-16 bg-muted/50 rounded"></div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 items-end">
                      <div className="flex gap-2">
                        <div className="h-6 w-16 bg-muted/50 rounded-full"></div>
                        <div className="h-6 w-20 bg-muted/50 rounded-full"></div>
                      </div>
                      <div className="h-9 w-20 bg-muted/50 rounded"></div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  <div className="space-y-2">
                    <div className="h-4 bg-muted/50 rounded w-full"></div>
                    <div className="h-4 bg-muted/50 rounded w-5/6"></div>
                    <div className="h-4 bg-muted/50 rounded w-4/6"></div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-6 w-16 bg-muted/50 rounded-full"></div>
                    <div className="h-6 w-20 bg-muted/50 rounded-full"></div>
                    <div className="h-6 w-14 bg-muted/50 rounded-full"></div>
                    <div className="h-6 w-18 bg-muted/50 rounded-full"></div>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-muted/30">
                    <div className="h-6 w-24 bg-muted/50 rounded"></div>
                    <div className="h-6 w-16 bg-muted/50 rounded"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
