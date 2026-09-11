// All request channels return the same serializable discriminated result.
export function registerRequest(ipcMain, channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return { success: true, data: await handler(event, ...args) }; }
    catch (error) {
      const message = typeof error?.message === 'string' ? error.message : String(error);
      const code = message.startsWith('OUTPUT_EXISTS:') ? 'OUTPUT_EXISTS' : typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED';
      return { success: false, error: message, code };
    }
  });
}
