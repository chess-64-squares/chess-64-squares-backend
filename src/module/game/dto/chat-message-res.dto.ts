export class ChatMessageResDto {
  id: number;
  gameId: number;
  senderId: number;
  senderUsername: string;
  message: string;
  createdAt: Date;
}
