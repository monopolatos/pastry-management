import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import logoUrl from "../assets/logo.jpeg";
// jsPDF's built-in fonts (helvetica/times/courier) only cover WinAnsi (Latin) characters — Greek
// text renders as garbage with them. Noto Sans (SIL OFL, see assets/fonts/OFL.txt) covers Greek as
// well as Latin, so it's embedded and used for every piece of text in this document instead.
import notoSansRegularUrl from "../assets/fonts/NotoSans-Regular.ttf";
import notoSansBoldUrl from "../assets/fonts/NotoSans-Bold.ttf";
import { readCustomTheme } from "./customTheme";

const PDF_FONT = "NotoSans";

export interface RawMaterialPdfRow {
  name: string;
  category: string;
  supplier: string;
  price: string;
  status: string;
}

/** A warm rose tone matching the shop's own logo — used whenever no custom brand color has been
 * picked in Settings, so the report still looks intentional rather than defaulting to plain black. */
const FALLBACK_ACCENT = "#9f5a68";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function loadLogoDataUrl(): Promise<string> {
  const response = await fetch(logoUrl);
  const buffer = await response.arrayBuffer();
  return `data:image/jpeg;base64,${arrayBufferToBase64(buffer)}`;
}

async function loadFontBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

/** Registers Noto Sans (regular + bold) on `doc` under the `NotoSans` family name, so Greek (and
 * any other non-Latin-1) text in the title, labels, and table renders correctly. */
async function registerPdfFont(doc: jsPDF): Promise<void> {
  const [regular, bold] = await Promise.all([
    loadFontBase64(notoSansRegularUrl),
    loadFontBase64(notoSansBoldUrl),
  ]);
  doc.addFileToVFS("NotoSans-Regular.ttf", regular);
  doc.addFont("NotoSans-Regular.ttf", PDF_FONT, "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", bold);
  doc.addFont("NotoSans-Bold.ttf", PDF_FONT, "bold");
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [159, 90, 104];
  const int = parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/**
 * Builds a professional-looking "Raw Materials" PDF report (logo header, generated-at timestamp,
 * and a striped table of name/category/supplier/price/status), returned as raw PDF bytes ready to
 * hand to `api/export.ts`'s `writeBinaryFile`. Kept in `lib/` rather than a component — building
 * the document is presentation logic, not UI, the same split the costing engine and Analytics
 * charts already use.
 */
export async function buildRawMaterialsPdf(
  rows: RawMaterialPdfRow[],
  options: {
    title: string;
    generatedAtLabel: string;
    columns: Record<keyof RawMaterialPdfRow, string>;
  },
): Promise<ArrayBuffer> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const [logoDataUrl] = await Promise.all([loadLogoDataUrl(), registerPdfFont(doc)]);

  const accentHex = readCustomTheme().primary ?? FALLBACK_ACCENT;
  const accentRgb = hexToRgb(accentHex);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.addImage(logoDataUrl, "JPEG", margin, 10, 22, 22);

  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  doc.text(options.title, margin + 28, 20);

  doc.setFont(PDF_FONT, "normal");
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(options.generatedAtLabel, margin + 28, 27);

  doc.setDrawColor(...accentRgb);
  doc.setLineWidth(0.6);
  doc.line(margin, 36, pageWidth - margin, 36);

  autoTable(doc, {
    startY: 42,
    margin: { left: margin, right: margin },
    head: [
      [
        options.columns.name,
        options.columns.category,
        options.columns.supplier,
        options.columns.price,
        options.columns.status,
      ],
    ],
    body: rows.map((row) => [row.name, row.category, row.supplier, row.price, row.status]),
    styles: { font: PDF_FONT, fontStyle: "normal", fontSize: 9.5, cellPadding: 2.4 },
    headStyles: {
      font: PDF_FONT,
      fillColor: accentRgb,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [247, 245, 246] },
  });

  // A page-number footer needs the final page count, which isn't known until the table (which may
  // span several pages) has finished drawing — so this is a second pass over every page already
  // drawn, not a per-page draw hook.
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont(PDF_FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(140, 140, 140);
    doc.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  return doc.output("arraybuffer");
}
