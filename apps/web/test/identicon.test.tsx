import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Identicon } from '../src/components/Identicon';

describe('Identicon 临时头像', () => {
  it('同 seed 输出确定一致', () => {
    const { container: a } = render(<Identicon seed="ABC123:joiner" />);
    const { container: b } = render(<Identicon seed="ABC123:joiner" />);
    const pathA = a.querySelector('path')?.getAttribute('d');
    const pathB = b.querySelector('path')?.getAttribute('d');
    expect(pathA).toBeTruthy();
    expect(pathA).toBe(pathB);
  });

  it('不同 seed 图案不同', () => {
    const { container: a } = render(<Identicon seed="ABC123:creator" />);
    const { container: b } = render(<Identicon seed="ABC123:joiner" />);
    expect(a.querySelector('path')?.getAttribute('d')).not.toBe(
      b.querySelector('path')?.getAttribute('d'),
    );
  });

  it('图案左右对称（5×5 网格镜像）', () => {
    const { container } = render(<Identicon seed="ZZ9ZZ0:creator" />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    const squares = d.match(/M(\d) (\d)h1v1h-1z/g) ?? [];
    expect(squares.length).toBeGreaterThan(0);
    const grid = new Set(
      squares.map((s) => {
        const m = /M(\d) (\d)/.exec(s)!;
        return `${m[1]},${m[2]}`;
      }),
    );
    for (const key of grid) {
      const [x, y] = key.split(',').map(Number);
      expect(grid.has(`${4 - x},${y}`)).toBe(true);
    }
  });

  it('渲染为无障碍 svg', () => {
    const { container } = render(<Identicon seed="X" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('临时头像');
  });
});
