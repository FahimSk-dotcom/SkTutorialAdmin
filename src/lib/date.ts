export const TIMEZONE = "Asia/Kolkata";

export function getKolkataToday(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export function getKolkataISOString(): string {
  return new Date().toISOString();
}

export function formatKolkataFullDate(dateStr?: string): string {
  let targetDate: Date;
  if (!dateStr) {
    targetDate = new Date();
  } else {
    targetDate = new Date(`${dateStr}T12:00:00`);
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(targetDate);
}

export function formatKolkataShortDate(dateStr: string): string {
  if (!dateStr) return "";
  const targetDate = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(targetDate);
}

export function getKolkataGreeting(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(formatter.format(new Date()), 10);

  if (hour >= 4 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function getMonthYearLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 15);
  return date.toLocaleString("en-IN", { month: "long", year: "numeric" });
}

export function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const totalDays = new Date(year, month, 0).getDate();

  for (let day = 1; day <= totalDays; day++) {
    const dStr = String(day).padStart(2, "0");
    const mStr = String(month).padStart(2, "0");
    days.push(`${year}-${mStr}-${dStr}`);
  }

  return days;
}

export function isFutureDate(dateStr: string): boolean {
  const today = getKolkataToday();
  return dateStr > today;
}
