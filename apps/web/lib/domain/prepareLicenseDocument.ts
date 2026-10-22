/** Browser-only, memory-only preparation. Never persist identity documents. */
export const LICENSE_INPUT_LIMIT = 5 * 1024 * 1024;
export const LICENSE_TRANSPORT_LIMIT = 3 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;

function canvas(width: number, height: number) {
  if (width * height > MAX_PIXELS || height > 16000 || width > 16000) throw new Error('DOCUMENT_TOO_COMPLEX');
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  const context = result.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  return { result, context };
}

async function encode(source: HTMLCanvasElement): Promise<File> {
  // PDF pages: keep the rendered resolution fixed (multi-page layout; see D-T3-03, not changed here).
  const file = await encodeWithin(source);
  if (file) return file;
  throw new Error('DOCUMENT_TOO_COMPLEX');
}

const QUALITIES = [0.92, 0.85, 0.78, 0.7] as const;
/** Smallest long side we accept when shrinking a photo: below this, CNH text stops being reliably legible. */
export const LICENSE_MIN_LONG_SIDE = 2400;
const LONG_SIDE_STEPS = [4000, 3200, LICENSE_MIN_LONG_SIDE] as const;

async function encodeWithin(source: HTMLCanvasElement): Promise<File | null> {
  for (const quality of QUALITIES) {
    const blob = await new Promise<Blob | null>(resolve => source.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size > 0 && blob.size <= LICENSE_TRANSPORT_LIMIT) {
      return new File([blob], 'license.jpg', { type: 'image/jpeg' });
    }
  }
  return null;
}

/**
 * D-T3-02: the sizes tried for a photo, largest first. Step 1 keeps the original resolution (capped at
 * MAX_PIXELS, so a 50 MP phone photo is no longer refused outright); then the long side goes down in steps
 * (4000 -> 3200 -> 2400 px), never below LICENSE_MIN_LONG_SIDE and never upscaled.
 */
export function licenseReductionPlan(width: number, height: number): {width: number; height: number}[] {
  if (!(width > 0) || !(height > 0)) return [];
  const long = Math.max(width, height);
  const capScale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)), 16000 / long);
  const sizes: {width: number; height: number}[] = [];
  const push = (scale: number) => {
    const w = Math.max(1, Math.floor(width * scale)); const h = Math.max(1, Math.floor(height * scale));
    if (!sizes.some(s => s.width === w && s.height === h)) sizes.push({width: w, height: h});
  };
  push(capScale);
  for (const side of LONG_SIDE_STEPS) if (side < long * capScale) push(side / long);
  return sizes;
}

/**
 * Re-encodes a decoded photo in memory, reducing quality and then resolution in steps until it fits the
 * transport limit. Throws DOCUMENT_TOO_LARGE when even the smallest legible size does not fit. The caller's
 * original File is never modified.
 */
export async function reduceLicenseImage(bitmap: {width: number; height: number}, draw: (context: CanvasRenderingContext2D, width: number, height: number) => void): Promise<File> {
  const plan = licenseReductionPlan(bitmap.width, bitmap.height);
  if (!plan.length) throw new Error('DOCUMENT_TOO_COMPLEX');
  for (const size of plan) {
    const {result, context} = canvas(size.width, size.height);
    try {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      draw(context, size.width, size.height);
      const file = await encodeWithin(result);
      if (file) return file;
    } finally { result.width = result.height = 0; }
  }
  throw new Error('DOCUMENT_TOO_LARGE');
}

export async function prepareLicenseDocument(file: File): Promise<File> {
  if (!file.size || file.size > LICENSE_INPUT_LIMIT) throw new Error('DOCUMENT_SIZE');
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') throw new Error('DOCUMENT_TYPE');
  if (file.size <= LICENSE_TRANSPORT_LIMIT) return file;
  if (file.type !== 'application/pdf') {
    const bitmap = await createImageBitmap(file);
    try {
      return await reduceLicenseImage(bitmap, (context, width, height) => context.drawImage(bitmap, 0, 0, width, height));
    } finally { bitmap.close(); }
  }
  // Render every page locally. No CDN, document upload, or first-page-only shortcut.
  const pdfjs = await import('pdfjs-dist');
  const port = new Worker(`${window.location.origin}/pdfjs/pdf.worker.min.mjs`, {type: 'module'});
  const worker: InstanceType<typeof pdfjs.PDFWorker> = pdfjs.PDFWorker.fromPort({port});
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()), worker,
    isEvalSupported: false, useSystemFonts: true,
    standardFontDataUrl: `${window.location.origin}/pdf-standard-fonts/`,
  });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 8) throw new Error('DOCUMENT_TOO_COMPLEX');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const natural = page.getViewport({scale: 1});
      const viewport = page.getViewport({scale: Math.min(3, 2400 / Math.max(natural.width, natural.height))});
      pages.push({page, viewport, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height)});
    }
    const width = Math.max(...pages.map(p => p.width));
    const height = pages.reduce((sum,p) => sum + p.height, 0);
    const {result, context} = canvas(width, height);
    try {
      let offset = 0;
      for (const {page, viewport, width: pageWidth, height: pageHeight} of pages) {
        const temporary = canvas(pageWidth, pageHeight);
        try {
          await page.render({canvasContext: temporary.context, viewport}).promise;
          context.drawImage(temporary.result, 0, offset);
        } finally { temporary.result.width = temporary.result.height = 0; page.cleanup(); }
        offset += pageHeight;
      }
      return await encode(result);
    } finally { result.width = result.height = 0; }
  } finally {
    try { await loading.destroy(); }
    finally {
      try { worker.destroy(); } finally { port.terminate(); }
    }
  }
}
