import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LICENSE_MIN_LONG_SIDE, LICENSE_TRANSPORT_LIMIT, licenseReductionPlan, prepareLicenseDocument} from './prepareLicenseDocument';
const pdf = vi.hoisted(() => ({pages: 2, renders: [] as number[], destroy: vi.fn(), workerDestroy: vi.fn()}));
vi.mock('pdfjs-dist', () => ({
  PDFWorker: class { static fromPort() {return new this();} destroy() {pdf.workerDestroy();} },
  getDocument: () => ({destroy: pdf.destroy, promise: Promise.resolve({
    get numPages() {return pdf.pages;},
    getPage: async (index: number) => ({
      getViewport: ({scale}: {scale: number}) => ({width: 600 * scale, height: 800 * scale}),
      render: () => ({promise: Promise.resolve(pdf.renders.push(index))}), cleanup: vi.fn(),
    }),
  })}),
}));
let encodedBytes = 200;
let encoded: {width: number; height: number; quality: number; bytes: number}[] = [];
let bitmapSize = {width: 1800, height: 2400};
/** Synthetic JPEG size model: bytes grow with pixels and quality (noisy photo ~ 1 byte/pixel at q 0.9). */
let sizeFor: ((width: number, height: number, quality: number) => number) | null = null;
let draws = 0;
const close = vi.fn();
const terminate = vi.fn();
beforeEach(() => {
  pdf.pages = 2; pdf.renders = []; pdf.destroy.mockClear(); pdf.workerDestroy.mockClear();
  encodedBytes = 200; draws = 0; close.mockClear(); terminate.mockClear();
  vi.stubGlobal('window', {location: {origin: 'https://fleet.example'}});
  vi.stubGlobal('Worker', class {terminate() {terminate();}});
  encoded = []; bitmapSize = {width: 1800, height: 2400}; sizeFor = null;
  vi.stubGlobal('document', {createElement: () => {
    const c = {width: 0, height: 0,
      getContext: () => ({fillStyle: '', fillRect() {}, drawImage() {draws++;}}),
      toBlob: (done: (blob: Blob) => void, _type: string, quality: number) => {
        const bytes = sizeFor ? sizeFor(c.width, c.height, quality) : encodedBytes;
        encoded.push({width: c.width, height: c.height, quality, bytes});
        done(new Blob([new Uint8Array(bytes)], {type: 'image/jpeg'}));
      },
    };
    return c;
  }});
  vi.stubGlobal('createImageBitmap', async () => ({...bitmapSize, close}));
});
afterEach(() => vi.unstubAllGlobals());
const large = (type: string) => new File([new Uint8Array(LICENSE_TRANSPORT_LIMIT + 1)], 'original', {type});
describe('memory-only license preparation', () => {
  it('preserves small PDFs unchanged', async () => {
    const file = new File(['pdf'], 'license.pdf', {type: 'application/pdf'});
    expect(await prepareLicenseDocument(file)).toBe(file);
    expect(pdf.renders).toEqual([]);
  });
  it('rejects an unsupported type before sending', async () => {
    await expect(prepareLicenseDocument(new File(['x'], 'x.txt', {type: 'text/plain'}))).rejects.toThrow('DOCUMENT_TYPE');
  });
  it('compresses large images and releases the decoded bitmap', async () => {
    const output = await prepareLicenseDocument(large('image/png'));
    expect(output.type).toBe('image/jpeg');
    expect(output.size).toBeLessThanOrEqual(LICENSE_TRANSPORT_LIMIT);
    expect(close).toHaveBeenCalledOnce();
  });
  it('never sends an image still larger than the transport limit', async () => {
    encodedBytes = LICENSE_TRANSPORT_LIMIT + 1;
    await expect(prepareLicenseDocument(large('image/png'))).rejects.toThrow('DOCUMENT_TOO_LARGE');
    expect(close).toHaveBeenCalledOnce();
    expect(encoded.every(e => Math.max(e.width, e.height) >= LICENSE_MIN_LONG_SIDE)).toBe(true);
  });
  it('renders every PDF page and terminates the worker', async () => {
    const output = await prepareLicenseDocument(large('application/pdf'));
    expect(output.type).toBe('image/jpeg');
    expect(pdf.renders).toEqual([1, 2]); expect(draws).toBe(2);
    expect(pdf.destroy).toHaveBeenCalledOnce();
    expect(pdf.workerDestroy).toHaveBeenCalledOnce(); expect(terminate).toHaveBeenCalledOnce();
  });
  it('rejects an overly complex PDF rather than dropping pages', async () => {
    pdf.pages = 9;
    await expect(prepareLicenseDocument(large('application/pdf'))).rejects.toThrow('DOCUMENT_TOO_COMPLEX');
    expect(pdf.renders).toEqual([]); expect(terminate).toHaveBeenCalledOnce();
  });
});
describe('D-T3-02 progressive reduction of large phone photos', () => {
  it('plans original size (capped at 24 MP), then 4000/3200/2400 px long side, never upscaling', () => {
    const plan = licenseReductionPlan(8160, 6120); // 50 MP
    expect(plan[0]!.width * plan[0]!.height).toBeLessThanOrEqual(24_000_000);
    expect(plan.map(p => Math.max(p.width, p.height))).toEqual([5656, 4000, 3200, 2400]);
    expect(plan.every(p => Math.abs(p.width / p.height - 8160 / 6120) < 0.01)).toBe(true);
    expect(licenseReductionPlan(4000, 3000).map(p => p.width)).toEqual([4000, 3200, 2400]);
    expect(licenseReductionPlan(2000, 1500)).toEqual([{width: 2000, height: 1500}]);
    expect(licenseReductionPlan(0, 10)).toEqual([]);
  });
  it('a 50 MP photo is no longer refused: it is reduced until it fits 3 MiB', async () => {
    bitmapSize = {width: 8160, height: 6120};
    sizeFor = (w, h, q) => Math.round(w * h * q * 0.9); // noisy: does not fit at 24 MP nor 4000 px
    const original = large('image/jpeg');
    const output = await prepareLicenseDocument(original);
    expect(output.size).toBeLessThanOrEqual(LICENSE_TRANSPORT_LIMIT);
    expect(output.type).toBe('image/jpeg');
    const last = encoded[encoded.length - 1]!;
    expect(Math.max(last.width, last.height)).toBeGreaterThanOrEqual(LICENSE_MIN_LONG_SIDE);
    expect(encoded[0]!.width * encoded[0]!.height).toBeLessThanOrEqual(24_000_000);
    // quality is lowered first at each size, then the resolution
    expect(encoded.slice(0, 4).map(e => e.quality)).toEqual([0.92, 0.85, 0.78, 0.7]);
    expect(original.size).toBe(LICENSE_TRANSPORT_LIMIT + 1); // original untouched
    expect(close).toHaveBeenCalledOnce();
  });
  it('a noisy 12 MP photo is reduced instead of refused', async () => {
    bitmapSize = {width: 4000, height: 3000};
    sizeFor = (w, h, q) => Math.round(w * h * q * 0.36);
    const output = await prepareLicenseDocument(large('image/jpeg'));
    expect(output.size).toBeLessThanOrEqual(LICENSE_TRANSPORT_LIMIT);
    expect(encoded.some(e => e.width === 4000 && e.quality === 0.7)).toBe(true); // full size tried first
  });
  it('stops at the minimum legible size and reports DOCUMENT_TOO_LARGE', async () => {
    bitmapSize = {width: 8160, height: 6120};
    sizeFor = () => LICENSE_TRANSPORT_LIMIT + 1;
    await expect(prepareLicenseDocument(large('image/jpeg'))).rejects.toThrow('DOCUMENT_TOO_LARGE');
    expect(Math.min(...encoded.map(e => Math.max(e.width, e.height)))).toBe(LICENSE_MIN_LONG_SIDE);
    expect(encoded).toHaveLength(16);
  });
});
