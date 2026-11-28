import type { MedicationClass } from '../condition';
import type { MessageKey } from '../i18n';

export function classLabelKey(medicationClass: MedicationClass): MessageKey {
  switch (medicationClass) {
    case 'simple_analgesic':
      return 'med.class.simple';
    case 'triptan':
      return 'med.class.triptan';
    case 'ergot':
      return 'med.class.ergot';
    case 'opioid':
      return 'med.class.opioid';
    case 'combination_analgesic':
      return 'med.class.combination';
    case 'gepant':
      return 'med.class.gepant';
    case 'other':
      return 'med.class.other';
  }
}
