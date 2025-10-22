
export enum ConnectionState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
  CLOSED = 'CLOSED',
}

export interface Transcript {
  speaker: 'user' | 'chaplain';
  text: string;
}
