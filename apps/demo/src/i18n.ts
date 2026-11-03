import { computed, ref } from 'vue';

type DemoLocale = 'zh' | 'en';

function readLocale(): string | undefined {
  const requested = new URLSearchParams(window.location.search).get('lang');
  if (requested) return requested;
  try {
    return localStorage.getItem('filens-locale') || undefined;
  } catch {
    return undefined;
  }
}

const requestedLocale = ref(readLocale());
const isEnglish = computed(() => /^en(?:[-_]|$)/i.test(requestedLocale.value ?? ''));
const locale = computed<DemoLocale>(() => isEnglish.value ? 'en' : 'zh');
const previewLocale = computed(() => requestedLocale.value);

export function useDemoI18n() {
  return {
    locale,
    isEnglish,
    previewLocale,
    t: (zh: string, en: string) => isEnglish.value ? en : zh,
    syncLocaleFromUrl: () => { requestedLocale.value = readLocale(); },
    toggleLocale: () => {
      const next: DemoLocale = isEnglish.value ? 'zh' : 'en';
      requestedLocale.value = next;
      try {
        localStorage.setItem('filens-locale', next);
      } catch {
        // Language switching also works when storage is unavailable.
      }
      const url = new URL(window.location.href);
      url.searchParams.set('lang', next);
      window.history.replaceState(window.history.state, '', url);
    }
  };
}
