// The time, refreshed once a minute on the minute: crisis mode's clocks never tick per second.
import { useEffect, useState } from 'react';

import { useOnResume } from '../lib/useOnResume';

const MINUTE_MS = 60 * 1000;

export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      // Aligned to the next minute boundary, so every figure on screen turns at the same moment.
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, MINUTE_MS - (Date.now() % MINUTE_MS));
    };
    schedule();
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Timers stop in the background; the figures catch up as soon as the app is back.
  useOnResume(() => {
    setNow(new Date());
  });

  return now;
}
