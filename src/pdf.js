// A small PDF maker (no library), copied from StoreOwl Back Office (src/invpdf.js). Helvetica in WinAnsi:
// plain letters, numbers and · – ’ ¢ × all print. Used by the app (Download PDF) and the website (the emailed invoice).
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const MAP = { '’': 39, '‘': 39, '“': 34, '”': 34, '–': 150, '—': 151, '·': 183, '•': 149, '¢': 162, '×': 215, '…': 133, 'é': 233, ' ': 32 };
function codes(s) {
  const out = [];
  for (const ch of String(s == null ? '' : s)) { const c = ch.charCodeAt(0); out.push(MAP[ch] != null ? MAP[ch] : c >= 32 && c < 127 ? c : c >= 160 && c < 256 ? c : 63); }
  return out;
}
export function textWidth(s, size, bold) {
  return codes(s).reduce((a, c) => a + (c >= 32 && c <= 126 ? W[c - 32] : 556), 0) * size / 1000 * (bold ? 1.06 : 1);
}
export function fit(s, size, max, bold) {
  s = String(s == null ? '' : s); if (textWidth(s, size, bold) <= max) return s;
  while (s.length > 1 && textWidth(s + '…', size, bold) > max) s = s.slice(0, -1);
  return s.replace(/\s+$/, '') + '…';
}
const rgb = (hex) => { const h = String(hex || '#000').replace('#', ''); return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' '); };
const esc = (cs) => cs.map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 128 ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0'))).join('');

export function pdfDoc(pw = 612, ph = 792) {
  const pages = [], imgs = []; let cur = null;
  const api = {
    w: pw, h: ph,
    page() { cur = []; pages.push(cur); return api; },
    text(x, y, s, o = {}) {
      const size = o.size || 10, bold = !!o.bold;
      let tx = x; if (o.align === 'right') tx = x - textWidth(s, size, bold); else if (o.align === 'center') tx = x - textWidth(s, size, bold) / 2;
      cur.push('BT ' + rgb(o.color || '#0F1B2D') + ' rg /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + tx.toFixed(2) + ' ' + (ph - y).toFixed(2) + ' Td (' + esc(codes(s)) + ') Tj ET');
      return api;
    },
    rect(x, y, w, h, fill, stroke) {
      if (fill) cur.push(rgb(fill) + ' rg ' + x.toFixed(2) + ' ' + (ph - y - h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f');
      if (stroke) cur.push(rgb(stroke) + ' RG 0.8 w ' + x.toFixed(2) + ' ' + (ph - y - h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re S');
      return api;
    },
    // A JPEG picture (img = {w, h, b: Uint8Array of the .jpg}) drawn in the box x, y (top-left), w × h.
    image(x, y, w, h, img) {
      if (!img || !img.b || !img.w) return api;
      let i = imgs.indexOf(img); if (i < 0) { imgs.push(img); i = imgs.length - 1; }
      cur.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + (ph - y - h).toFixed(2) + ' cm /Im' + i + ' Do Q');
      return api;
    },
    line(x1, y1, x2, y2, color, wd) { cur.push(rgb(color || '#E3E6EB') + ' RG ' + (wd || 0.7) + ' w ' + x1.toFixed(2) + ' ' + (ph - y1).toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + (ph - y2).toFixed(2) + ' l S'); return api; },
    get count() { return pages.length; },
    bytes() {
      const objs = [], n = pages.length;
      objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
      objs[2] = '<< /Type /Pages /Kids [' + pages.map((_, i) => (5 + i * 2) + ' 0 R').join(' ') + '] /Count ' + n + ' >>';
      objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
      const io = 5 + n * 2, xo = imgs.length ? ' /XObject << ' + imgs.map((_, k) => '/Im' + k + ' ' + (io + k) + ' 0 R').join(' ') + ' >>' : '';
      imgs.forEach((m, k) => {
        let raw = ''; for (let j = 0; j < m.b.length; j++) raw += String.fromCharCode(m.b[j]);
        objs[io + k] = '<< /Type /XObject /Subtype /Image /Width ' + m.w + ' /Height ' + m.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + m.b.length + ' >>\nstream\n' + raw + '\nendstream';
      });
      pages.forEach((p, i) => {
        const s = p.join('\n');
        objs[5 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + xo + ' >> /Contents ' + (6 + i * 2) + ' 0 R >>';
        objs[6 + i * 2] = '<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream';
      });
      let out = '%PDF-1.4\n'; const off = [];
      for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
      const x = out.length;
      out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n' + off.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
      out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
      const b = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 255; return b;
    }
  };
  return api;
}
