// Deterministic widths for skeleton cells (avoids hydration mismatch)
const CELL_WIDTHS = [
  [75, 82, 68, 91, 77, 85, 72], // Row 0
  [88, 73, 95, 81, 69, 92, 78], // Row 1
  [71, 89, 76, 84, 93, 67, 86], // Row 2
  [82, 74, 87, 79, 91, 73, 88], // Row 3
  [76, 91, 68, 85, 72, 94, 81], // Row 4
  [89, 77, 93, 71, 86, 74, 90], // Row 5
  [73, 85, 79, 92, 76, 88, 84], // Row 6
  [87, 72, 91, 78, 83, 95, 77], // Row 7
];

export default function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden animate-pulse">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-5 bg-gray-200 rounded w-32"></div>
            <div className="h-4 bg-gray-200 rounded w-48"></div>
          </div>
          <div className="h-10 w-32 bg-gray-200 rounded-lg"></div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <th key={i} className="px-6 py-3">
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex}>
                {[1, 2, 3, 4, 5, 6, 7].map((colIndex) => {
                  const widthIndex = rowIndex % CELL_WIDTHS.length;
                  const width = CELL_WIDTHS[widthIndex][colIndex - 1];
                  return (
                    <td key={colIndex} className="px-6 py-4">
                      <div
                        className="h-4 bg-gray-200 rounded"
                        style={{
                          width: `${width}%`,
                          animationDelay: `${rowIndex * 100 + colIndex * 50}ms`,
                        }}
                      ></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
