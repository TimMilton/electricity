/**
 * CSV для Excel (UTF-8 з BOM, роздільник «;»).
 * Захист від CSV/формульних ін'єкцій: текст, що починається з = + - @ або
 * табуляції, екранується апострофом (числа не змінюються).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  const numeric = /^-?\d+([.,]\d+)?$/.test(s);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, rows: unknown[][]): Response {
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
