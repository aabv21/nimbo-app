import * as Location from 'expo-location';

import { captureCoarseLocation, toCoarse } from '../coarseLocation';

const permission = (granted: boolean): Location.LocationPermissionResponse =>
  ({ granted, canAskAgain: true, expires: 'never' }) as Location.LocationPermissionResponse;

beforeEach(() => {
  jest.clearAllMocks();
});

test('a position keeps one decimal, about 11 km', () => {
  expect(toCoarse(4.71234, -74.07219)).toEqual({ lat: 4.7, lon: -74.1 });
  expect(toCoarse(-33.4569, -70.6483)).toEqual({ lat: -33.5, lon: -70.6 });
});

test('with the permission denied it resolves null and never reads a position', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(permission(false));

  await expect(captureCoarseLocation()).resolves.toBeNull();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
});

test('with the permission granted it asks for the lowest accuracy and rounds what it gets', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(permission(true));
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
    coords: { latitude: 4.71234, longitude: -74.07219 },
  } as Location.LocationObject);

  await expect(captureCoarseLocation()).resolves.toEqual({ lat: 4.7, lon: -74.1 });
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Lowest });
});

test('a position that cannot be read resolves null', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(permission(true));
  jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error('Location services are off'));

  await expect(captureCoarseLocation()).resolves.toBeNull();
});
