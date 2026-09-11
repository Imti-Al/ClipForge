import type { IpcResult } from '../types/electron';

export function unwrapIpc<T>(result: IpcResult<T>): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}
