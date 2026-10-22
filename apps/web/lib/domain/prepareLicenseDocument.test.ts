import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LICENSE_TRANSPORT_LIMIT, prepareLicenseDocument} from './prepareLicenseDocument';
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
let draws = 0;
const close = vi.fn();
const terminate = vi.fn();
beforeEach(() => {
  pdf.pages = 2; pdf.renders = []; pdf.destroy.mockClear(); pdf.workerDestroy.mockClear();
  encodedBytes = 200; draws = 0; close.mockClear(); terminate.mockClear();
  vi.stubGlobal('window', {location: {origin: 'https://fleet.example'}});
  vi.stubGlobal('Worker', class {terminate() {terminate();}});
  vi.stubGlobal('document', {createElement: () => ({width: 0, height: 0,
    getContext: () => ({fillStyle: '', fillRect() {}, drawImage() {draws++;}}),
    toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array(encodedBytes)], {type: 'image/jpeg'})),
  })});
  vi.stubGlobal('createImageBitmap', async () => ({width: 1800, height: 2400, close}));
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
    await expect(prepareLicenseDocument(large('image/png'))).rejects.toThrow('DOCUMENT_TOO_COMPLEX');
    expect(close).toHaveBeenCalledOnce();
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
