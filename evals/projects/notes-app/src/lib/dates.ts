const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Oct 5, 2026", in UTC so every visitor sees the same date.
export function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  return `${months[date.getUTCMonth()]} ${date.getUTCDay()}, ${date.getUTCFullYear()}`;
}
