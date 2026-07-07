export class PuzzleResDto {
  puzzleId: number;
  fen: string;
  solutionMoves: string;
  rating: number;
  theme: string;
  sideToMove: 'white' | 'black';
}
