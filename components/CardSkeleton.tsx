// Deterministic widths for variety (avoids hydration mismatch)
const CARD_VARIATIONS = [
  { name: 75, type: 50, stat1: 75, stat2: 65, stat3: 85, stat4: 55, thesis: [100, 100, 70] },
  { name: 80, type: 60, stat1: 70, stat2: 80, stat3: 60, stat4: 70, thesis: [100, 95, 75] },
  { name: 70, type: 55, stat1: 85, stat2: 70, stat3: 75, stat4: 60, thesis: [100, 100, 65] },
  { name: 85, type: 65, stat1: 65, stat2: 75, stat3: 80, stat4: 50, thesis: [100, 90, 80] },
  { name: 75, type: 50, stat1: 80, stat2: 85, stat3: 70, stat4: 65, thesis: [100, 100, 60] },
  { name: 90, type: 70, stat1: 75, stat2: 60, stat3: 85, stat4: 55, thesis: [100, 85, 70] },
];

export default function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => {
        const variation = CARD_VARIATIONS[index % CARD_VARIATIONS.length];
        return (
          <div
            key={index}
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm animate-pulse"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 space-y-2">
                <div className="h-5 bg-gray-200 rounded" style={{ width: `${variation.name}%` }}></div>
                <div className="h-4 bg-gray-200 rounded" style={{ width: `${variation.type}%` }}></div>
              </div>
              <div className="flex gap-2">
                <div className="h-8 w-8 bg-gray-200 rounded-lg"></div>
                <div className="h-8 w-8 bg-gray-200 rounded-lg"></div>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0 mt-0.5"></div>
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-4 bg-gray-200 rounded" style={{ width: `${variation.stat1}%` }}></div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0 mt-0.5"></div>
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                  <div className="h-4 bg-gray-200 rounded" style={{ width: `${variation.stat2}%` }}></div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0 mt-0.5"></div>
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                  <div className="h-4 bg-gray-200 rounded" style={{ width: `${variation.stat3}%` }}></div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0 mt-0.5"></div>
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-4 bg-gray-200 rounded" style={{ width: `${variation.stat4}%` }}></div>
                </div>
              </div>

              {/* Thesis section */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="h-3 bg-gray-200 rounded w-1/3 mb-1"></div>
                <div className="space-y-1">
                  <div className="h-3 bg-gray-200 rounded" style={{ width: `${variation.thesis[0]}%` }}></div>
                  <div className="h-3 bg-gray-200 rounded" style={{ width: `${variation.thesis[1]}%` }}></div>
                  <div className="h-3 bg-gray-200 rounded" style={{ width: `${variation.thesis[2]}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
