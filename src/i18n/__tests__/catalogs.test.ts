import { emergencyRegions, packs } from '../../condition';
import { catalogs, isMessageKey, resolveLocale, translate } from '../index';

test.each(['es', 'pt'] as const)('%s has exactly the keys of en', (locale) => {
  expect(Object.keys(catalogs[locale]).sort()).toEqual(Object.keys(catalogs.en).sort());
});

test.each(['en', 'es', 'pt'] as const)('%s has no empty message', (locale) => {
  for (const text of Object.values(catalogs[locale])) expect(text.trim()).not.toBe('');
});

test.each(['es', 'pt'] as const)('%s keeps the placeholders of en', (locale) => {
  const names = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
  for (const [key, text] of Object.entries(catalogs.en)) {
    expect(names(catalogs[locale][key as keyof typeof catalogs.en])).toEqual(names(text));
  }
});

test('resolveLocale picks the first supported language and falls back to en', () => {
  expect(resolveLocale(['pt-BR'])).toBe('pt');
  expect(resolveLocale(['pt-PT'])).toBe('pt');
  expect(resolveLocale(['fr-FR', 'es-AR'])).toBe('es');
  expect(resolveLocale(['fr-FR'])).toBe('en');
  expect(resolveLocale([])).toBe('en');
});

test('every condition catalog item has a label in the catalog', () => {
  for (const catalog of ['painAreas', 'symptoms', 'triggers', 'reliefs'] as const) {
    for (const item of packs.migraine[catalog]) expect(isMessageKey(item.labelKey)).toBe(true);
  }
});

test('params are interpolated', () => {
  expect(translate('en', 'profile.signedInAs', { email: 'a@b.co' })).toContain('a@b.co');
});

test('every red flag why line and every emergency region name is in the catalog', () => {
  for (const flag of packs.migraine.redFlags) expect(isMessageKey(flag.whyKey)).toBe(true);
  for (const region of emergencyRegions) expect(isMessageKey(`region.${region.toLowerCase()}`)).toBe(true);
});
