import { Prisma } from '@photoo/db';

export interface DeviceDeleteClient {
  delete(args: { where: { id: string } }): Promise<unknown>;
}

// P2025-safe: the device may already be gone (deleted by push-receipts, or
// by the user themselves) by the time a DeviceNotRegistered result for it
// is handled.
export async function deleteDeviceIfPresent(
  device: DeviceDeleteClient,
  deviceId: string,
): Promise<void> {
  try {
    await device.delete({ where: { id: deviceId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return;
    }
    throw error;
  }
}
