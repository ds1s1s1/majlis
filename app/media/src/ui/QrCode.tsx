import { useMemo } from 'react';
import { encodeQrMatrix } from '../utils/qrEncode';

export function QrCode({
  value,
  size = 148,
  fg = '#12100E',
  bg = '#F6F1E7',
  className = '',
}: {
  value: string;
  size?: number;
  fg?: string;
  bg?: string;
  className?: string;
}) {
  const mat = useMemo(() => encodeQrMatrix(value), [value]);
  const margin = 3;
  const viewSize = mat.size + margin * 2;
  const d = useMemo(() => {
    let paths = '';
    for (let r = 0; r < mat.size; r++) {
      for (let c = 0; c < mat.size; c++) {
        if (mat.rows[r][c]) paths += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
    return paths;
  }, [mat]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR Code"
      className={`rounded-xl ${className}`}
    >
      <rect width={viewSize} height={viewSize} rx={2} fill={bg} />
      <path d={d} fill={fg} />
    </svg>
  );
}
