export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  receiverId: string;
  senderName: string;
  timeLeft?: number | null; // ✅ Pour les messages éphémères (optionnel)
}
