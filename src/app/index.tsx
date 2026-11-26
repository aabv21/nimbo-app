import { Redirect } from 'expo-router';

import { useAuth } from '../auth/AuthProvider';
import { nextRoute } from '../auth/gate';

// The one route that is always registered: it forwards to whichever screen the account state allows.
// The root layout shows its loading view instead of the stack while the target is `/loading`.
export default function Index(): React.JSX.Element | null {
  const target = nextRoute(useAuth());
  return target === '/loading' ? null : <Redirect href={target} />;
}
