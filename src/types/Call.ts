import type { Timestamp } from "firebase/firestore";

export type CallStatus = "idle" | "ringing" | "in_call" | "ended";

export interface CallRecord {
  chatId: string;
  roomId: string;
  from: string;
  to?: string;
  callMode?: "audio" | "video";
  callUUID?: string;
  status: CallStatus;
  createdAt?: Timestamp;
  acceptedAt?: Timestamp;
  endedAt?: Timestamp;
  updatedAt?: Timestamp;
}