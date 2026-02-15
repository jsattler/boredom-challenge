export interface Session {
  id: string;
  startTime: string;
  duration: number; // minutes
  completed: boolean;
  completedAt: string | null;
  failedAttentionCheck: boolean;
  attentionChecksResponded: number;
}

export interface AppData {
  theme: 'light' | 'dark';
  sessions: Session[];
  currentStreak: number;
  longestStreak: number;
}

const STORAGE_KEY = 'boredom-challenge-data';

function getDefaultData(): AppData {
  return {
    theme: 'light',
    sessions: [],
    currentStreak: 0,
    longestStreak: 0,
  };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultData();
    const parsed = JSON.parse(raw);
    return { ...getDefaultData(), ...parsed };
  } catch {
    return getDefaultData();
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function generateId(): string {
  return crypto.randomUUID();
}

/** Get date string in local timezone (YYYY-MM-DD) */
function toLocalDateString(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Calculate streaks from session data */
export function recalculateStreaks(sessions: Session[]): { currentStreak: number; longestStreak: number } {
  const completedDays = new Set<string>();
  for (const s of sessions) {
    if (s.completed && s.completedAt) {
      completedDays.add(toLocalDateString(s.completedAt));
    }
  }

  if (completedDays.size === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const sortedDays = Array.from(completedDays).sort();
  
  let longestStreak = 1;
  let streak = 1;
  
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1]);
    const curr = new Date(sortedDays[i]);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      streak++;
    } else {
      streak = 1;
    }
    longestStreak = Math.max(longestStreak, streak);
  }

  // Current streak: count backwards from today
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  let currentStreak = 0;
  let checkDate = new Date(todayStr);
  
  // Check today first, if not completed today, check yesterday as the latest
  if (!completedDays.has(todayStr)) {
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterdayStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    if (!completedDays.has(yesterdayStr)) {
      return { currentStreak: 0, longestStreak };
    }
  }

  while (true) {
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    if (completedDays.has(dateStr)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return { currentStreak, longestStreak };
}

/** Save a completed or failed session */
export function saveSession(session: Session): AppData {
  const data = loadData();
  data.sessions.push(session);
  const streaks = recalculateStreaks(data.sessions);
  data.currentStreak = streaks.currentStreak;
  data.longestStreak = streaks.longestStreak;
  saveData(data);
  return data;
}

/** Get completed days as a Set of YYYY-MM-DD strings */
export function getCompletedDays(sessions: Session[]): Set<string> {
  const days = new Set<string>();
  for (const s of sessions) {
    if (s.completed && s.completedAt) {
      days.add(toLocalDateString(s.completedAt));
    }
  }
  return days;
}

/** Export data as JSON */
export function exportData(): string {
  const data = loadData();
  const completedSessions = data.sessions.filter(s => s.completed);
  const failedSessions = data.sessions.filter(s => !s.completed);
  const totalMinutes = completedSessions.reduce((sum, s) => sum + s.duration, 0);
  const totalChecks = data.sessions.reduce((sum, s) => sum + s.attentionChecksResponded, 0);
  const failedChecks = data.sessions.filter(s => s.failedAttentionCheck).length;

  const exportObj = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    sessions: data.sessions,
    stats: {
      totalSessions: data.sessions.length,
      completedSessions: completedSessions.length,
      failedSessions: failedSessions.length,
      currentStreak: data.currentStreak,
      longestStreak: data.longestStreak,
      totalMinutes,
      attentionCheckSuccessRate: totalChecks > 0 ? (totalChecks - failedChecks) / totalChecks : 1,
    },
  };

  return JSON.stringify(exportObj, null, 2);
}

/** Import data, returns summary or error */
export function importData(jsonString: string): { success: boolean; message: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { success: false, message: 'Invalid file format. Please select a valid export file.' };
  }

  if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
    return { success: false, message: 'File is missing required data. Please use a valid export file.' };
  }

  // Validate sessions have required fields
  for (const s of parsed.sessions) {
    if (!s.id || !s.startTime || typeof s.duration !== 'number' || typeof s.completed !== 'boolean') {
      return { success: false, message: 'File is missing required data. Please use a valid export file.' };
    }
  }

  const data = loadData();
  const existingIds = new Set(data.sessions.map(s => s.id));
  let imported = 0;
  let skipped = 0;

  for (const s of parsed.sessions) {
    if (existingIds.has(s.id)) {
      skipped++;
    } else {
      data.sessions.push({
        id: s.id,
        startTime: s.startTime,
        duration: s.duration,
        completed: s.completed,
        completedAt: s.completedAt || null,
        failedAttentionCheck: s.failedAttentionCheck || false,
        attentionChecksResponded: s.attentionChecksResponded || 0,
      });
      imported++;
    }
  }

  const streaks = recalculateStreaks(data.sessions);
  data.currentStreak = streaks.currentStreak;
  data.longestStreak = streaks.longestStreak;
  saveData(data);

  return {
    success: true,
    message: `Imported ${imported} session${imported !== 1 ? 's' : ''}, skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}`,
  };
}

/** Get/set theme */
export function getTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('boredom-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme: 'light' | 'dark'): void {
  localStorage.setItem('boredom-theme', theme);
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/** Get last used duration or default */
export function getLastDuration(): number {
  const raw = localStorage.getItem('boredom-last-duration');
  if (raw) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 60) return n;
  }
  return 15; // default 15 minutes
}

export function setLastDuration(minutes: number): void {
  localStorage.setItem('boredom-last-duration', String(minutes));
}
