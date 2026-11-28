import { translate } from '../index';
import { pluralCategory, translatePlural } from '../plural';

test('en picks .one for 1 and .other for any other count', () => {
  expect(translatePlural('en', 'sync.pending.count', 1)).toBe('1 record to upload');
  expect(translatePlural('en', 'sync.pending.count', 3)).toBe('3 records to upload');
  expect(translatePlural('en', 'sync.pending.count', 0)).toBe('0 records to upload');
});

test('es and pt give the same forms', () => {
  expect(translatePlural('es', 'sync.pending.count', 1)).toBe('1 registro por subir');
  expect(translatePlural('es', 'sync.pending.count', 3)).toBe('3 registros por subir');
  expect(translatePlural('pt', 'sync.pending.count', 1)).toBe('1 registro para enviar');
  expect(translatePlural('pt', 'sync.pending.count', 3)).toBe('3 registros para enviar');
});

test('CLDR categories: pt counts 0 as one, es and pt have many for whole millions', () => {
  expect(pluralCategory('en', 0)).toBe('other');
  expect(pluralCategory('es', 0)).toBe('other');
  expect(pluralCategory('pt', 0)).toBe('one');
  expect(pluralCategory('en', 1_000_000)).toBe('other');
  expect(pluralCategory('es', 1_000_000)).toBe('many');
  expect(pluralCategory('pt', 2_000_000)).toBe('many');
  expect(pluralCategory('es', 1_000_001)).toBe('other');
});

test('a missing .many falls back to .other', () => {
  expect(translatePlural('es', 'sync.pending.count', 1_000_000)).toBe(
    translate('es', 'sync.pending.count.other', { n: 1_000_000 }),
  );
});

test('the count fills {n}; the .one form of sync.failed.body names no number', () => {
  expect(translatePlural('en', 'sync.failed.body', 4)).toContain('Your 4 records are still saved');
  expect(translatePlural('en', 'sync.failed.body', 1)).toContain('Your record is still saved');
});
