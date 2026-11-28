// A module mock for `../push/pushRegistration`, for suites that render the root layout without the Supabase client:
//   jest.mock('../push/pushRegistration', () => require('../test/pushClientsMock'));
export const registerPush = jest.fn(() => Promise.resolve('saved'));
export const forgetPushToken = jest.fn(() => Promise.resolve());
export const forgetPushTokenLater = jest.fn();
export const flushPendingUnregister = jest.fn(() => Promise.resolve());
export const resumePushClaim = jest.fn(() => Promise.resolve());
export const confirmPushClaim = jest.fn(() => Promise.resolve(false));
