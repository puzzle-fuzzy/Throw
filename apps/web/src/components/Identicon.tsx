import { useMemo } from 'react';

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * GitHub 风格临时头像（identicon）：同一 seed 确定性生成 5×5 左右对称图案。
 * seed = `${房间码}:${角色}` —— 双方各自独立计算得到一致的对方头像，无需任何存储。
 */
export function Identicon({
  seed,
  size = 28,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const { hue, path } = useMemo(() => {
    const rand = mulberry32(fnv1a(seed));
    const h = Math.floor(rand() * 360);
    let d = '';
    for (let y = 0; y < 5; y++) {
      const half = [rand() > 0.5, rand() > 0.5, rand() > 0.5];
      for (let x = 0; x < 5; x++) {
        const on = x < 3 ? half[x]! : half[4 - x]!;
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { hue: h, path: d };
  }, [seed]);

  return (
    <svg
      viewBox="-0.1 -0.1 5.2 5.2"
      width={size}
      height={size}
      className={`shrink-0 rounded-md ${className ?? ''}`}
      role="img"
      aria-label="临时头像"
    >
      <rect x="-0.1" y="-0.1" width="5.2" height="5.2" rx="0.6" fill="var(--background)" />
      <path d={path} fill={`hsl(${hue} 52% 46%)`} />
    </svg>
  );
}
