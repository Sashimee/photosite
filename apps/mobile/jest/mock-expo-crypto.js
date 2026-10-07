/* global jest */
let mockCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    mockCounter += 1;
    return `00000000-0000-4000-8000-${String(mockCounter).padStart(12, '0')}`;
  },
}));
