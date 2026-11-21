export function getNextStudentId(lastStudentId?: string | null): string {
  const match = lastStudentId?.match(/SK-(\d+)/);
  const nextNumber = match ? parseInt(match[1], 10) + 1 : 1001;
  return `SK-${nextNumber}`;
}
