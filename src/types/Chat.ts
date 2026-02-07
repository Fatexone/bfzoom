import type { Timestamp } from "firebase/firestore";

export type ChatType = "direct" | "group";

export type ChatMessageType = "text" | "image" | "file" | "voice";

export interface ChatLastMessage {
  text?: string;
  senderId?: string;
  createdAt?: Timestamp | null;
  type?: ChatMessageType;
}

export interface Chat {
  id: string;
  type: ChatType;
  participants: string[];
  admins?: string[];
  title?: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastMessage?: ChatLastMessage | null;
}

export interface ChatAttachment {
  url: string;
  path: string;
  name: string;
  size: number;
  contentType: string;
}

export interface ChatVoiceNote {
  url: string;
  path: string;
  duration: number;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  text?: string;
  encrypted?: boolean;
  ciphertext?: string;
  keyId?: string;
  senderId: string;
  senderName: string;
  createdAt?: Timestamp | null;
  attachment?: ChatAttachment;
  voiceNote?: ChatVoiceNote;
}