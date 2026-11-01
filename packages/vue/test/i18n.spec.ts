import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { previewLocales, previewMessages, resolvePreviewLocale, translatePreview, usePreviewI18n } from '../src/i18n';

describe('preview localization', () => {
  it('ships all 28 ZimaOS locales with complete messages and matching placeholders', () => {
    expect(previewLocales).toHaveLength(28);
    const english = previewMessages.en_US;
    const parameters = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];
    for (const locale of previewLocales) {
      expect(Object.keys(previewMessages[locale]).sort(), locale).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(previewMessages[locale])) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('');
        expect(parameters(value), `${locale}: ${key}`).toEqual(parameters(key));
      }
    }
  });
  it.each([
    ['zh-Hans-HK', 'zh_CN'], ['zh_CN', 'zh_CN'], ['zh-Hans-CN', 'zh_CN'], ['zh-Hant', 'zh_TW'], ['zh-HK', 'zh_TW'],
    ['en-GB', 'en_GB'], ['pt-BR', 'pt_BR'], ['de-AT', 'de_DE'], ['no', 'nb_NO'], ['xx', 'en_US']
  ])('resolves %s to %s', (input, expected) => expect(resolvePreviewLocale(input)).toBe(expected));

  it('tries browser preferences in order and defaults safely during SSR', () => {
    expect(resolvePreviewLocale(['xx', 'fr-CA', 'de'])).toBe('fr_FR');
    expect(resolvePreviewLocale()).toBe('en_US');
    vi.stubGlobal('navigator', undefined);
    const Harness = defineComponent({ setup: () => usePreviewI18n({}), template: `<span>{{ t('Next') }}</span>` });
    const wrapper = mount(Harness);
    expect(wrapper.text()).toBe('Next');
    wrapper.unmount(); vi.unstubAllGlobals();
  });
  it('preserves placeholders and source text when a host message is absent', () => {
    expect(translatePreview('fr_FR', 'Warnings: {count}', { count: 3 })).toBe('Avertissements : 3');
    expect(translatePreview('de_DE', 'Host message')).toBe('Host message');
    expect(translatePreview('de_DE', 'constructor')).toBe('constructor');
    expect(translatePreview('zh_CN', 'Host {name}', { name: '<b>$&</b>' })).toBe('Host <b>$&</b>');
  });
  it('updates an instance reactively without changing another preview', async () => {
    const Harness = defineComponent({
      props: { locale: String, messages: Object },
      setup: props => usePreviewI18n(props as { locale?: string; messages?: Record<string, string> }),
      template: `<span>{{ t('Next') }}</span>`
    });
    const first = mount(Harness, { props: { locale: 'zh_CN' } });
    const second = mount(Harness, { props: { locale: 'de_DE' } });
    expect(first.text()).toBe('下一页'); expect(second.text()).toBe('Weiter');
    await first.setProps({ locale: 'ja_JP' }); expect(first.text()).toBe('次へ');
    await first.setProps({ messages: { Next: 'Forward' } }); expect(first.text()).toBe('Forward');
    expect(second.text()).toBe('Weiter'); first.unmount(); second.unmount();
  });
});
