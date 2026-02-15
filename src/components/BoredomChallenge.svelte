<script lang="ts">
  import {
    loadData,
    saveSession,
    generateId,
    getCompletedDays,
    recalculateStreaks,
    exportData,
    importData,
    getTheme,
    setTheme,
    getLastDuration,
    setLastDuration,
    type Session,
  } from '../lib/store';

  // --- State ---
  type AppState = 'idle' | 'running' | 'attention-check' | 'completed' | 'failed';

  let state: AppState = $state('idle');
  let durationMinutes: number = $state(15);
  let remainingSeconds: number = $state(0);
  let dark: boolean = $state(false);

  // Attention check
  let attentionProgress: number = $state(100); // 100 to 0
  let attentionChecksResponded: number = $state(0);

  // Session tracking
  let sessionStartTime: string = $state('');
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let attentionInterval: ReturnType<typeof setInterval> | null = null;
  let attentionTimeout: ReturnType<typeof setTimeout> | null = null;
  let attentionBarInterval: ReturnType<typeof setInterval> | null = null;
  let nextAttentionCheck: number = 0; // seconds until next check

  // Streak data
  let completedDays: Set<string> = $state(new Set());
  let currentStreak: number = $state(0);

  // Import message
  let importMessage: string = $state('');
  let importMessageType: 'success' | 'error' = $state('success');
  let importMessageTimeout: ReturnType<typeof setTimeout> | null = null;

  // Fade states
  let attentionVisible: boolean = $state(false);

  // --- Initialization ---
  function init() {
    const data = loadData();
    completedDays = getCompletedDays(data.sessions);
    const streaks = recalculateStreaks(data.sessions);
    currentStreak = streaks.currentStreak;
    dark = getTheme() === 'dark';
    durationMinutes = getLastDuration();
    remainingSeconds = durationMinutes * 60;
  }

  $effect(() => {
    init();

    function handleKeydown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        handleAction();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      cleanup();
    };
  });

  // --- Timer display ---
  let displayTime: string = $derived.by(() => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  });

  // --- Scroll to adjust duration ---
  function handleWheel(e: WheelEvent) {
    if (state !== 'idle') return;
    e.preventDefault();
    if (e.deltaY < 0) {
      durationMinutes = Math.min(60, durationMinutes + 1);
    } else {
      durationMinutes = Math.max(1, durationMinutes - 1);
    }
    remainingSeconds = durationMinutes * 60;
    setLastDuration(durationMinutes);
  }

  // --- Touch support for mobile ---
  let touchStartY: number = 0;
  let touchAccumulated: number = 0;

  function handleTouchStart(e: TouchEvent) {
    if (state !== 'idle') return;
    touchStartY = e.touches[0].clientY;
    touchAccumulated = 0;
  }

  function handleTouchMove(e: TouchEvent) {
    if (state !== 'idle') return;
    e.preventDefault();
    const deltaY = touchStartY - e.touches[0].clientY;
    touchAccumulated += deltaY;
    touchStartY = e.touches[0].clientY;

    // Every 30px of movement = 1 minute
    const steps = Math.trunc(touchAccumulated / 30);
    if (steps !== 0) {
      touchAccumulated -= steps * 30;
      durationMinutes = Math.min(60, Math.max(1, durationMinutes + steps));
      remainingSeconds = durationMinutes * 60;
      setLastDuration(durationMinutes);
    }
  }

  // --- Actions ---
  function handleAction() {
    switch (state) {
      case 'idle':
        startSession();
        break;
      case 'running':
        // No action while running (space doesn't stop it)
        break;
      case 'attention-check':
        respondToAttentionCheck();
        break;
      // completed/failed handled by buttons
    }
  }

  function handleClick() {
    handleAction();
  }

  function startSession() {
    state = 'running';
    sessionStartTime = new Date().toISOString();
    attentionChecksResponded = 0;
    remainingSeconds = durationMinutes * 60;
    scheduleNextAttentionCheck();

    timerInterval = setInterval(() => {
      remainingSeconds--;

      // Check if it's time for attention check
      nextAttentionCheck--;
      if (nextAttentionCheck <= 0 && state === 'running') {
        triggerAttentionCheck();
      }

      if (remainingSeconds <= 0) {
        remainingSeconds = 0;
        completeTimer();
      }
    }, 1000);
  }

  function scheduleNextAttentionCheck() {
    // Random interval between 30 seconds and 2 minutes (30-120 seconds)
    nextAttentionCheck = 30 + Math.floor(Math.random() * 91);
  }

  function triggerAttentionCheck() {
    state = 'attention-check';
    attentionProgress = 100;
    attentionVisible = true;

    // Decrease progress bar over 10 seconds
    const startTime = Date.now();
    const duration = 10000; // 10 seconds

    attentionBarInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      attentionProgress = Math.max(0, 100 - (elapsed / duration) * 100);
    }, 50);

    // Fail after 10 seconds
    attentionTimeout = setTimeout(() => {
      failSession();
    }, 10000);
  }

  function respondToAttentionCheck() {
    if (state !== 'attention-check') return;
    attentionChecksResponded++;
    clearAttentionCheck();
    state = 'running';
    attentionVisible = false;
    scheduleNextAttentionCheck();
  }

  function clearAttentionCheck() {
    if (attentionTimeout) {
      clearTimeout(attentionTimeout);
      attentionTimeout = null;
    }
    if (attentionBarInterval) {
      clearInterval(attentionBarInterval);
      attentionBarInterval = null;
    }
  }

  function completeTimer() {
    cleanup();
    state = 'completed';
  }

  function failSession() {
    clearAttentionCheck();
    cleanup();

    const session: Session = {
      id: generateId(),
      startTime: sessionStartTime,
      duration: durationMinutes,
      completed: false,
      completedAt: null,
      failedAttentionCheck: true,
      attentionChecksResponded,
    };

    const data = saveSession(session);
    completedDays = getCompletedDays(data.sessions);
    currentStreak = data.currentStreak;

    state = 'failed';
    attentionVisible = false;
    remainingSeconds = durationMinutes * 60;
  }

  function confirmCompletion(stayedBored: boolean) {
    const session: Session = {
      id: generateId(),
      startTime: sessionStartTime,
      duration: durationMinutes,
      completed: stayedBored,
      completedAt: stayedBored ? new Date().toISOString() : null,
      failedAttentionCheck: false,
      attentionChecksResponded,
    };

    const data = saveSession(session);
    completedDays = getCompletedDays(data.sessions);
    currentStreak = data.currentStreak;

    state = 'idle';
    remainingSeconds = durationMinutes * 60;
  }

  function dismissFailed() {
    state = 'idle';
    remainingSeconds = durationMinutes * 60;
  }

  function cleanup() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    clearAttentionCheck();
  }

  // --- Theme ---
  function toggleTheme() {
    dark = !dark;
    setTheme(dark ? 'dark' : 'light');
  }

  // --- Export ---
  function handleExport() {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `boredom-challenge-export-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Import ---
  let fileInput: HTMLInputElement;

  function handleImportClick() {
    fileInput.click();
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = importData(reader.result as string);
      showImportMessage(result.message, result.success ? 'success' : 'error');

      if (result.success) {
        const data = loadData();
        completedDays = getCompletedDays(data.sessions);
        currentStreak = data.currentStreak;
      }
    };
    reader.onerror = () => {
      showImportMessage('Unable to read file. Please try a different export file.', 'error');
    };
    reader.readAsText(file);
    input.value = '';
  }

  function showImportMessage(msg: string, type: 'success' | 'error') {
    importMessage = msg;
    importMessageType = type;
    if (importMessageTimeout) clearTimeout(importMessageTimeout);
    importMessageTimeout = setTimeout(() => {
      importMessage = '';
    }, 5000);
  }

  // --- Streak calendar ---
  function getStreakDays(): { date: string; completed: boolean }[] {
    const days: { date: string; completed: boolean }[] = [];
    const today = new Date();

    // Show up to 14 days
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: dateStr, completed: completedDays.has(dateStr) });
    }
    return days;
  }

  let streakDays = $derived(getStreakDays());

  function formatDayLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'narrow' });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
  onwheel={handleWheel}
  onclick={handleClick}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
>
  <!-- Theme toggle - top right -->
  <button
    onclick={(e) => { e.stopPropagation(); toggleTheme(); }}
    class="absolute top-4 right-4 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 transition-colors text-sm cursor-pointer"
    aria-label="Toggle dark mode"
  >
    {dark ? 'light' : 'dark'}
  </button>

  <!-- Timer display -->
  <div class="flex flex-col items-center justify-center flex-1 relative">
    <div
      class="text-8xl sm:text-9xl md:text-[12rem] font-normal tabular-nums tracking-tight text-black/70 dark:text-white/70"
      aria-live="polite"
      aria-label={`Timer: ${displayTime}`}
    >
      {displayTime}
    </div>

    <!-- Below-timer content: positioned absolutely so it never shifts the timer -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 mt-16 sm:mt-20 md:mt-28 w-64 sm:w-80">
      <!-- Idle hint -->
      {#if state === 'idle'}
        <p class="text-black/25 dark:text-white/25 text-sm text-center">
          scroll to adjust &middot; tap or space to start
        </p>
        <p class="text-black/20 dark:text-white/20 text-sm text-center mt-2">
          confirm your presence when asked
        </p>
      {/if}

      <!-- Attention check -->
      {#if state === 'attention-check'}
        <div
          class="transition-opacity duration-300"
          class:opacity-100={attentionVisible}
          class:opacity-0={!attentionVisible}
        >
          <div class="w-full h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              class="h-full bg-black/30 dark:bg-white/30 rounded-full transition-none"
              style="width: {attentionProgress}%"
            ></div>
          </div>
        <p class="text-black/40 dark:text-white/40 text-sm text-center mt-3">
          Press space or click anywhere to confirm you are still here
        </p>
        </div>
      {/if}

      <!-- Completion prompt -->
      {#if state === 'completed'}
        <div class="flex flex-col items-center gap-4">
          <p class="text-black/50 dark:text-white/50 text-sm">Did you stay bored?</p>
          <div class="flex gap-3">
            <button
              onclick={(e) => { e.stopPropagation(); confirmCompletion(true); }}
              class="px-4 py-2 text-sm border border-black/20 dark:border-white/20 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              Yes, I stayed bored
            </button>
            <button
              onclick={(e) => { e.stopPropagation(); confirmCompletion(false); }}
              class="px-4 py-2 text-sm border border-black/10 dark:border-white/10 rounded text-black/40 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              No, I got distracted
            </button>
          </div>
        </div>
      {/if}

      <!-- Failed attention check message -->
      {#if state === 'failed'}
        <div class="flex flex-col items-center gap-4">
          <p class="text-black/40 dark:text-white/40 text-sm">
            Attention check failed. Session does not count.
          </p>
          <button
            onclick={(e) => { e.stopPropagation(); dismissFailed(); }}
            class="px-4 py-2 text-sm border border-black/20 dark:border-white/20 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            OK
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Bottom section -->
  <div class="w-full px-4 pb-4 flex items-end justify-between">
    <!-- Streak display - bottom center -->
    <div class="flex-1"></div>
    <div class="flex gap-1 items-end" aria-label="Streak calendar">
      {#each streakDays as day}
        <div class="flex flex-col items-center gap-0.5">
          <div
            class="w-3 h-3 sm:w-4 sm:h-4 rounded-sm {day.completed
              ? 'bg-black dark:bg-white'
              : 'bg-black/10 dark:bg-white/10'}"
            title={day.date}
            aria-label={`${day.date}: ${day.completed ? 'completed' : 'not completed'}`}
          ></div>
        </div>
      {/each}
    </div>
    <div class="flex-1 flex justify-end gap-2">
      <!-- Import/Export - bottom right -->
      <input
        bind:this={fileInput}
        type="file"
        accept=".json"
        onchange={handleFileChange}
        class="hidden"
        aria-label="Import sessions file"
      />
      <button
        onclick={(e) => { e.stopPropagation(); handleImportClick(); }}
        class="text-black/20 dark:text-white/20 hover:text-black/50 dark:hover:text-white/50 transition-colors text-sm cursor-pointer"
        aria-label="Import data"
        title="Import data"
      >
        import
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); handleExport(); }}
        class="text-black/20 dark:text-white/20 hover:text-black/50 dark:hover:text-white/50 transition-colors text-sm cursor-pointer"
        aria-label="Export data"
        title="Export data"
      >
        export
      </button>
    </div>
  </div>

  <!-- Import message toast -->
  {#if importMessage}
    <div
      class="absolute bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 text-sm rounded
        {importMessageType === 'success'
          ? 'bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60'
          : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}"
    >
      {importMessage}
    </div>
  {/if}
</div>
