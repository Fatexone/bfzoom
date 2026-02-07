export interface ChatMessage {
  id: string;
  text: string;
  originalText?: string;
  translatedText?: string;
  sourceLang?: string;
  targetLang?: string;
  senderId: string;
  receiverId: string;
  senderName: string;
  timeLeft?: number | null; // ✅ Pour les messages éphémères (optionnel)
}