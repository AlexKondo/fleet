import "server-only";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

// Copied into the repo (not read from node_modules/pdfjs-dist/standard_fonts) on purpose:
// Vercel's serverless packaging step fails outright ("invalid deployment package... files
// in symlinked directories") when an `outputFileTracingIncludes` entry points at a path
// pnpm resolves through a symlink, which node_modules/pdfjs-dist always is in this
// monorepo. Plain files living inside the app itself have no such symlink to trip over.
const STANDARD_FONT_DATA_URL = `${path.join(path.dirname(fileURLToPath(import.meta.url)), "pdf-standard-fonts")}/`;

/**
 * Renders a PDF's first page to a PNG buffer, server-side, at a fixed high resolution —
 * used so a CNH Digital PDF upload gets the exact same quality-controlled path as a
 * photo upload (analyzeDriversLicense.ts's `detail: "high"` image_url), instead of
 * relying on OpenAI's own internal PDF rasterization, which has no exposed
 * resolution/quality control and repeatedly produced misreads of small printed dates in
 * testing (the actual root cause, not the model or the prompt).
 *
 * @napi-rs/canvas instead of the more common `canvas` package: `canvas` needs system
 * Cairo/Pango libraries that aren't present in Vercel's serverless runtime; @napi-rs/canvas
 * ships prebuilt native bindings for linux-x64-gnu and works there with no extra setup.
 */
export async function renderPdfFirstPageToPng(pdfBytes: Uint8Array): Promise<Buffer> {
  const doc = await pdfjsLib.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
    // Required for pdf.js to render standard (non-embedded) fonts like Helvetica —
    // without it, any glyph using a base-14 font throws instead of rendering.
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;
  const page = await doc.getPage(1);

  // scale 3 ≈ 216 DPI at a standard 72-DPI PDF page — comfortably enough to resolve the
  // small colored "4a/4b" date fields that were getting lost at whatever resolution
  // OpenAI's own PDF rasterization was using internally.
  const viewport = page.getViewport({ scale: 3 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");

  await page.render({
    // @napi-rs/canvas's 2D context is API-compatible with the browser Canvas2D
    // interface pdf.js expects, but isn't literally the same TS type.
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  return canvas.toBuffer("image/png");
}
