import { act, renderHook } from '@testing-library/react-native';

import { localDb } from '../../lib/local/db';
import * as outbox from '../../lib/outbox/outbox';
import { listOutbox } from '../../lib/outbox/outbox';
import { clearLocalDb } from '../../test/localDbTest';
import { saveMedication, useMedications } from '../medicationStore';
import type { MedicationInput } from '../medicationStore';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));

const ID = '00000000-0000-4000-8000-0000000000a1';
const TRIPTAN: MedicationInput = {
  name: 'Sumatriptan',
  kind: 'acute',
  form: 'oral',
  medicationClass: 'triptan',
  doseText: '50 mg, one tablet',
  minIntervalHours: null,
  schedule: null,
  scheduleTime: null,
  scheduleAnchor: null,
  archived: false,
};

beforeEach(clearLocalDb);

interface Row {
  name: string;
  class: string;
  min_interval_minutes: number | null;
  archived_at: string | null;
  dirty: number;
  user_id: string;
}

function rows(): Row[] {
  return localDb().getAllSync<Row>('SELECT name, class, min_interval_minutes, archived_at, dirty, user_id FROM medications;');
}

test('saves the mirror row and queues save_medication with snake_case fields', () => {
  saveMedication('user-a', ID, { ...TRIPTAN, minIntervalHours: 4 });

  expect(rows()).toEqual([
    expect.objectContaining({ name: 'Sumatriptan', class: 'triptan', min_interval_minutes: 240, archived_at: null, dirty: 1, user_id: 'user-a' }),
  ]);
  expect(listOutbox('user-a')).toEqual([
    expect.objectContaining({
      kind: 'save_medication',
      recordKey: ID,
      args: {
        p_id: ID,
        p_fields: {
          name: 'Sumatriptan',
          kind: 'acute',
          form: 'oral',
          class: 'triptan',
          dose_text: '50 mg, one tablet',
          min_interval_minutes: 240,
          schedule: null,
          schedule_time: null,
          schedule_anchor: null,
          archived: false,
        },
      },
    }),
  ]);
});

test('an interval of 1.5 hours is stored as 90 minutes', () => {
  saveMedication('user-a', ID, { ...TRIPTAN, minIntervalHours: 1.5 });
  expect(rows()[0]?.min_interval_minutes).toBe(90);
  const args = listOutbox('user-a')[0]?.args as { p_fields: unknown };
  expect(args.p_fields).toEqual(expect.objectContaining({ min_interval_minutes: 90 }));
});

test('a save and its queued operation are one transaction', () => {
  const failing = jest.spyOn(outbox, 'enqueue').mockImplementation(() => {
    throw new Error('the outbox write failed');
  });
  try {
    expect(() => {
      saveMedication('user-a', ID, TRIPTAN);
    }).toThrow('the outbox write failed');
    expect(rows()).toEqual([]);
  } finally {
    failing.mockRestore();
  }
});

test('saving again edits the same row and keeps its first archive stamp', () => {
  saveMedication('user-a', ID, TRIPTAN);
  saveMedication('user-a', ID, { ...TRIPTAN, name: 'Sumatriptan 50', archived: true });
  const first = rows()[0]?.archived_at;
  saveMedication('user-a', ID, { ...TRIPTAN, name: 'Sumatriptan 50', archived: true });

  expect(rows()).toHaveLength(1);
  expect(rows()[0]?.name).toBe('Sumatriptan 50');
  expect(first).not.toBeNull();
  expect(rows()[0]?.archived_at).toBe(first);
  expect(listOutbox('user-a')).toHaveLength(3);
});

test('useMedications hides archived medications unless asked, and never shows another user', async () => {
  saveMedication('user-a', ID, TRIPTAN);
  saveMedication('user-a', '00000000-0000-4000-8000-0000000000a2', { ...TRIPTAN, name: 'Old', archived: true });
  saveMedication('user-b', '00000000-0000-4000-8000-0000000000b1', { ...TRIPTAN, name: 'Theirs' });

  const visible = await renderHook(() => useMedications('user-a'));
  expect(visible.result.current.map((med) => med.name)).toEqual(['Sumatriptan']);

  const all = await renderHook(() => useMedications('user-a', { includeArchived: true }));
  expect(all.result.current.map((med) => med.name)).toEqual(['Old', 'Sumatriptan']);
});

test('useMedications maps a row to a Medication and re-reads after a save', async () => {
  const hook = await renderHook(() => useMedications('user-a'));
  expect(hook.result.current).toEqual([]);

  await act(async () => {
    saveMedication('user-a', ID, { ...TRIPTAN, minIntervalHours: 2 });
    await Promise.resolve();
  });

  expect(hook.result.current).toEqual([
    {
      id: ID,
      name: 'Sumatriptan',
      kind: 'acute',
      form: 'oral',
      medicationClass: 'triptan',
      doseText: '50 mg, one tablet',
      minIntervalMinutes: 120,
      schedule: null,
      scheduleTime: null,
      scheduleAnchor: null,
      archived: false,
      dirty: true,
    },
  ]);
});

// The server refuses these for good (23514), so the store refuses them before anything is written.
test.each([
  ['an empty name', { name: '' }],
  ['a name of spaces', { name: '   ' }],
  ['a name over 80 characters', { name: 'a'.repeat(81) }],
  ['a dose over 120 characters', { doseText: 'a'.repeat(121) }],
])('%s throws RangeError and writes nothing', (_name, change) => {
  expect(() => {
    saveMedication('user-1', ID, { ...TRIPTAN, ...change });
  }).toThrow(RangeError);
  expect(rows()).toEqual([]);
  expect(listOutbox('user-1')).toEqual([]);
});

test('the name and dose are saved trimmed, at their longest allowed', () => {
  saveMedication('user-1', ID, { ...TRIPTAN, name: ` ${'a'.repeat(80)} `, doseText: 'b'.repeat(120) });
  expect(rows()[0]?.name).toBe('a'.repeat(80));
  const fields = (listOutbox('user-1')[0]?.args as { p_fields: Record<string, unknown> } | undefined)?.p_fields;
  expect(fields?.['name']).toBe('a'.repeat(80));
  expect(fields?.['dose_text']).toBe('b'.repeat(120));
});
