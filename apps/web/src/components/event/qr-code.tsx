import { encode } from "uqr";

export function QrCode({
  value,
  size = 160,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const matrix = encode(value, { ecc: "M", border: 1 }).data;
  const n = matrix.length;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="bg-white"
    >
      <rect width={n} height={n} fill="white" />
      {matrix.flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="black" /> : null,
        ),
      )}
    </svg>
  );
}
