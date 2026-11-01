import { computed } from 'vue';
import en_US from './locales/en_US.json';
import en_GB from './locales/en_GB.json';
import it_IT from './locales/it_IT.json';
import nb_NO from './locales/nb_NO.json';
import zh_CN from './locales/zh_CN.json';
import zh_TW from './locales/zh_TW.json';
import ja_JP from './locales/ja_JP.json';
import ko_KR from './locales/ko_KR.json';
import fr_FR from './locales/fr_FR.json';
import de_DE from './locales/de_DE.json';
import sv_SE from './locales/sv_SE.json';
import da_DK from './locales/da_DK.json';
import nl_NL from './locales/nl_NL.json';
import es_ES from './locales/es_ES.json';
import ca_ES from './locales/ca_ES.json';
import pt_PT from './locales/pt_PT.json';
import pt_BR from './locales/pt_BR.json';
import pl_PL from './locales/pl_PL.json';
import cs_CZ from './locales/cs_CZ.json';
import sk_SK from './locales/sk_SK.json';
import hu_HU from './locales/hu_HU.json';
import ro_RO from './locales/ro_RO.json';
import hr_HR from './locales/hr_HR.json';
import ru_RU from './locales/ru_RU.json';
import tr_TR from './locales/tr_TR.json';
import el_GR from './locales/el_GR.json';
import ga_IE from './locales/ga_IE.json';
import ml_IN from './locales/ml_IN.json';

/** English source phrases are stable message keys. Overrides apply to this instance only. */
export type PreviewMessages = Readonly<Record<string, string>>;
export const previewMessages = {
  en_US, en_GB, it_IT, nb_NO, zh_CN, zh_TW, ja_JP, ko_KR, fr_FR, de_DE, sv_SE,
  da_DK, nl_NL, es_ES, ca_ES, pt_PT, pt_BR, pl_PL, cs_CZ, sk_SK, hu_HU, ro_RO,
  hr_HR, ru_RU, tr_TR, el_GR, ga_IE, ml_IN
} as const;
export type PreviewLocale = keyof typeof previewMessages;
export const previewLocales = Object.freeze(Object.keys(previewMessages) as PreviewLocale[]);

/** Accept ZimaOS locale codes and BCP 47 tags, including script variants of Chinese. */
export function resolvePreviewLocale(requested?: string | readonly string[]): PreviewLocale {
  const candidates = typeof requested === 'string' ? [requested] : requested ?? [];
  for (const candidate of candidates) {
    const tag = candidate.replace(/_/g, '-').toLowerCase();
    const exact = previewLocales.find(code => code.replace('_', '-').toLowerCase() === tag);
    if (exact) return exact;
    const parts = tag.split('-');
    if (parts[0] === 'zh') {
      if (parts.includes('hans')) return 'zh_CN';
      return parts.some(part => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh_TW' : 'zh_CN';
    }
    if (parts[0] === 'no') return 'nb_NO';
    const language = previewLocales.find(code => code.split('_')[0] === parts[0]);
    if (language) return language;
  }
  return 'en_US';
}

export function translatePreview(locale: PreviewLocale, key: string, params: Record<string, string | number> = {}, messages?: PreviewMessages): string {
  const dictionary: PreviewMessages = previewMessages[locale];
  const fallback: PreviewMessages = en_US;
  const lookup = (table: PreviewMessages | undefined) => table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  const template = lookup(messages) ?? lookup(dictionary) ?? lookup(fallback) ?? key;
  return template.replace(/\{(\w+)\}/g, (token, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token);
}

export function usePreviewI18n(props: { locale?: string; messages?: PreviewMessages }) {
  const locale = computed(() => resolvePreviewLocale(props.locale ?? (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language])));
  return {
    locale,
    t: (key: string, params?: Record<string, string | number>) => translatePreview(locale.value, key, params, props.messages)
  };
}
