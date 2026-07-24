import { describe, expect, it } from 'vitest';
import * as __testedFile from './ProgressBar';

describe('src/web/components/ProgressBar.tsx', () => {
  describe('ProgressBar', () => {
    const { default: ProgressBar } = __testedFile;
    // props: ProgressBarProps

    it('0-0-0-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 0, totalDiscovered: 0 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 0, 0, 0);
      expectedDetermined(html, 0);
    });

    it('0-0-1-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 0, totalDiscovered: 1 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectDiscovering(html);
      expectedIndetermined(html);
    });

    it('0-10-1-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 10, totalDiscovered: 1 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectDiscovering(html);
      expectedIndetermined(html);
    });

    it('0-10-10-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 10, totalDiscovered: 10 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 0, 10, 0);
      expectedDetermined(html, 0);
    });

    it('3-10-10-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 3, totalPages: 10, totalDiscovered: 10 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 3, 10, 30);
      expectedDetermined(html, 30);
    });

    it('10-10-10-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 10, totalPages: 10, totalDiscovered: 10 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 10, 10, 100);
      expectedDetermined(html, 100);
    });

    it('3-10-12-u', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 3, totalPages: 10, totalDiscovered: 12 },
        showText: undefined,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 3, 10, 30, 12);
      expectedDetermined(html, 30);
    });

    it('0-0-0-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 0, totalDiscovered: 0 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedDetermined(html, 0);
    });

    it('0-0-1-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 0, totalDiscovered: 1 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedIndetermined(html);
    });

    it('0-10-1-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 10, totalDiscovered: 1 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedIndetermined(html);
    });

    it('0-10-10-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 10, totalDiscovered: 10 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedDetermined(html, 0);
    });

    it('3-10-10-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 3, totalPages: 10, totalDiscovered: 10 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedDetermined(html, 30);
    });

    it('10-10-10-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 10, totalPages: 10, totalDiscovered: 10 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedDetermined(html, 100);
    });

    it('3-10-12-f', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 3, totalPages: 10, totalDiscovered: 12 },
        showText: false,
      };
      const html = ProgressBar({ ...props }) as string;
      expectNoProgress(html);
      expectedDetermined(html, 30);
    });

    it('0-0-0-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 0, totalDiscovered: 0 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 0, 0, 0);
      expectedDetermined(html, 0);
    });

    it('0-0-1-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 0, totalDiscovered: 1 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectDiscovering(html);
      expectedIndetermined(html);
    });

    it('0-10-1-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 10, totalDiscovered: 1 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectDiscovering(html);
      expectedIndetermined(html);
    });

    it('0-10-10-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 0, totalPages: 10, totalDiscovered: 10 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 0, 10, 0);
      expectedDetermined(html, 0);
    });

    it('3-10-10-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 3, totalPages: 10, totalDiscovered: 10 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 3, 10, 30);
      expectedDetermined(html, 30);
    });

    it('10-10-10-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 10, totalPages: 10, totalDiscovered: 10 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 10, 10, 100);
      expectedDetermined(html, 100);
    });

    it('3-10-12-t', async () => {
      const props: Parameters<typeof ProgressBar>[0] = {
        progress: { pages: 3, totalPages: 10, totalDiscovered: 12 },
        showText: true,
      };
      const html = ProgressBar({ ...props }) as string;
      expectProgress(html, 3, 10, 30, 12);
      expectedDetermined(html, 30);
    });
  });
});

function expectProgress(html: string, v1: number, v2: number, v3: number, v4?: number) {
  const overflow = v4 ? ` • ${v4} total` : '';
  expect(html).toContain('<span>Progress</span>');
  expect(html).toContain(`<span>${v1}/${v2} pages (${v3}%)${overflow}</span>`);
}

function expectNoProgress(html: string) {
  expect(html).not.toContain('<span>Progress</span>');
  expect(html).not.toMatch(/\d+\/\d+ pages \(\d+%\)/);
}

function expectDiscovering(html: string) {
  expect(html).toContain('<span>Progress</span>');
  expect(html).toContain('<span>Discovering pages...</span>');
}

function expectedDetermined(html: string, v: number) {
  expect(html).toContain(`transition-all duration-300" style="width: ${v}%"`);
}

function expectedIndetermined(html: string) {
  expect(html).toContain('animate-pulse" style="width: 30%"');
}

// 3TG (https://3tg.dev) created 21 tests in 2922 ms (139.143 ms per generated test) @ 2026-03-18T19:16:04.880Z
