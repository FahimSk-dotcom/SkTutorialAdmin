export function cleanClassDisplay(classStr: string): string {
  if (!classStr) return "-";
  return classStr.replace(/^class\s+/i, "").trim();
}
