export function closeLiveRoomSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // The runtime or peer may already have closed the socket.
  }
}
