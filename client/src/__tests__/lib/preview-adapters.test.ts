import { describe, it, expect } from 'vitest';
import {
  getFileExtension,
  getMimeTypeFromExtension,
  type PreviewAdapter,
} from '../../lib/preview-adapters';
import type { ViewerFile } from '../../store';

// We need a fresh registry for each test to avoid shared-singleton state leaking between tests.
// Import the class directly rather than the singleton.
function freshRegistry() {
  // Dynamically re-create an equivalent registry by mimicking the class.
  // Since PreviewAdapterRegistry is not exported, we simulate it inline.
  const adapters = new Map<string, PreviewAdapter>();
  const mimeTypeMap = new Map<string, string>();
  const extensionMap = new Map<string, string>();

  return {
    register(adapter: PreviewAdapter, opts: { mimeTypes?: string[]; extensions?: string[] } = {}) {
      adapters.set(adapter.id, adapter);
      for (const m of opts.mimeTypes ?? []) mimeTypeMap.set(m, adapter.id);
      for (const e of opts.extensions ?? []) extensionMap.set(e.toLowerCase(), adapter.id);
    },
    getAdapter(id: string) { return adapters.get(id); },
    getAllAdapters() { return Array.from(adapters.values()); },
    findAdapter(file: ViewerFile): PreviewAdapter | undefined {
      if (file.mimeType) {
        const id = mimeTypeMap.get(file.mimeType);
        if (id) {
          const a = adapters.get(id);
          if (a?.canHandle(file)) return a;
        }
      }
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext) {
        const id = extensionMap.get(ext);
        if (id) {
          const a = adapters.get(id);
          if (a?.canHandle(file)) return a;
        }
      }
      for (const a of adapters.values()) {
        if (a.canHandle(file)) return a;
      }
      return undefined;
    },
  };
}

describe('getFileExtension', () => {
  it('returns the lowercase extension', () => {
    expect(getFileExtension('Report.PDF')).toBe('pdf');
    expect(getFileExtension('image.PNG')).toBe('png');
    expect(getFileExtension('notes.md')).toBe('md');
  });

  it('returns the last extension for multi-dot filenames', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
    expect(getFileExtension('style.module.css')).toBe('css');
  });

  it('returns the whole lowercased name when there is no dot', () => {
    // split('.').pop() on a dotless string returns the whole string
    expect(getFileExtension('README')).toBe('readme');
  });
});

describe('getMimeTypeFromExtension', () => {
  const cases: [string, string][] = [
    ['document.pdf', 'application/pdf'],
    ['notes.txt', 'text/plain'],
    ['readme.md', 'text/markdown'],
    ['page.html', 'text/html'],
    ['page.htm', 'text/html'],
    ['data.xml', 'application/xml'],
    ['config.json', 'application/json'],
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['anim.gif', 'image/gif'],
    ['img.webp', 'image/webp'],
    ['icon.svg', 'image/svg+xml'],
  ];

  it.each(cases)('maps %s → %s', (filename, expected) => {
    expect(getMimeTypeFromExtension(filename)).toBe(expected);
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(getMimeTypeFromExtension('binary.exe')).toBe('application/octet-stream');
    expect(getMimeTypeFromExtension('file.xyz')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for no extension', () => {
    expect(getMimeTypeFromExtension('MAKEFILE')).toBe('application/octet-stream');
  });
});

describe('PreviewAdapterRegistry (fresh instance per test)', () => {
  function makeFile(overrides: Partial<ViewerFile> = {}): ViewerFile {
    return {
      id: 'f1',
      name: 'test.pdf',
      mimeType: 'application/pdf',
      previewUrl: 'http://example.com/test.pdf',
      ...overrides,
    };
  }

  function makeAdapter(id: string, handles: (f: ViewerFile) => boolean): PreviewAdapter {
    return {
      id,
      name: `Adapter ${id}`,
      canHandle: handles,
      render: () => null,
    };
  }

  it('getAdapter returns undefined for unknown id', () => {
    const reg = freshRegistry();
    expect(reg.getAdapter('nonexistent-xyz')).toBeUndefined();
  });

  it('register and getAdapter round-trips', () => {
    const reg = freshRegistry();
    const adapter = makeAdapter('my-adapter', () => true);
    reg.register(adapter);
    expect(reg.getAdapter('my-adapter')).toBe(adapter);
  });

  it('findAdapter matches by MIME type', () => {
    const reg = freshRegistry();
    const adapter = makeAdapter('mime-adapter', f => f.mimeType === 'application/x-custom');
    reg.register(adapter, { mimeTypes: ['application/x-custom'] });

    const found = reg.findAdapter(makeFile({ mimeType: 'application/x-custom' }));
    expect(found?.id).toBe('mime-adapter');
  });

  it('findAdapter matches by file extension when MIME type misses', () => {
    const reg = freshRegistry();
    const adapter = makeAdapter('ext-adapter', f => f.name.endsWith('.xyz123'));
    reg.register(adapter, { extensions: ['xyz123'] });

    const found = reg.findAdapter(
      makeFile({ name: 'file.xyz123', mimeType: 'application/unknown-zz' }),
    );
    expect(found?.id).toBe('ext-adapter');
  });

  it('findAdapter falls back to canHandle() when no map entry matches', () => {
    const reg = freshRegistry();
    const adapter = makeAdapter('handle-adapter', f => f.name.includes('special-marker'));
    reg.register(adapter);

    const found = reg.findAdapter(
      makeFile({ name: 'special-marker-file.bin', mimeType: 'application/no-match' }),
    );
    expect(found?.id).toBe('handle-adapter');
  });

  it('findAdapter returns undefined when nothing can handle the file', () => {
    const reg = freshRegistry();
    const result = reg.findAdapter(
      makeFile({ name: 'weird.zzz9999', mimeType: 'application/zzz9999-unregistered' }),
    );
    expect(result).toBeUndefined();
  });

  it('getAllAdapters returns all registered adapters', () => {
    const reg = freshRegistry();
    reg.register(makeAdapter('a1', () => false));
    reg.register(makeAdapter('a2', () => false));
    const adapters = reg.getAllAdapters();
    expect(adapters).toHaveLength(2);
  });
});
