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
  // Keep the resolution fixed: never silently shrink text until it is unreadable.
  for (const quality of [0.95, 0.88, 0.8, 0.72]) {
    const blob = await new Promise<Blob | null>(resolve => source.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size > 0 && blob.size <= LICENSE_TRANSPORT_LIMIT) {
      return new File([blob], 'license.jpg', { type: 'image/jpeg' });
    }
  }
  throw new Error('DOCUMENT_TOO_COMPLEX');
}

export async function prepareLicenseDocument(file: File): Promise<File> {
  if (!file.size || file.size > LICENSE_INPUT_LIMIT) throw new Error('DOCUMENT_SIZE');
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') throw new Error('DOCUMENT_TYPE');
  if (file.size <= LICENSE_TRANSPORT_LIMIT) return file;
  if (file.type !== 'application/pdf') {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('DOCUMENT_TOO_COMPLEX');
      const {result, context} = canvas(bitmap.width, bitmap.height);
      try {
        context.drawImage(bitmap, 0, 0);
        return await encode(result);
      } finally { result.width = result.height = 0; }
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
