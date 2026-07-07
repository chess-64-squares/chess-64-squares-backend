export interface PuzzleSeedEntry {
  fen: string;
  solutionMoves: string;
  rating: number;
  theme: string;
  sideToMove: 'white' | 'black';
}

/**
 * Every entry's fen + solutionMoves has been verified with chess.js: each move
 * in the sequence is legal from the resulting position, and mate-labeled
 * lines were checked to actually reach checkmate (with a single forced
 * reply where more than one ply is required).
 */
export const PUZZLE_SEED_DATA: PuzzleSeedEntry[] = [
  {
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    solutionMoves: 'e1e8',
    rating: 800,
    theme: 'mate-in-1',
    sideToMove: 'white',
  },
  {
    fen: '7k/6pp/8/8/8/8/6PP/4R1K1 w - - 0 1',
    solutionMoves: 'e1e8',
    rating: 800,
    theme: 'mate-in-1',
    sideToMove: 'white',
  },
  {
    fen: '6k1/6pp/8/8/8/8/1r3PPP/6K1 b - - 0 1',
    solutionMoves: 'b2b1',
    rating: 800,
    theme: 'mate-in-1',
    sideToMove: 'black',
  },
  {
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    solutionMoves: 'h5f7',
    rating: 900,
    theme: 'mate-in-1',
    sideToMove: 'white',
  },
  {
    fen: '6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1',
    solutionMoves: 'c1c8',
    rating: 850,
    theme: 'mate-in-1',
    sideToMove: 'white',
  },
  {
    fen: 'r3k2r/ppp2Npp/1b5n/4p2b/2B1P2q/BQP2P2/P5PP/RN2K2R b KQkq - 0 1',
    solutionMoves: 'h4f2',
    rating: 1000,
    theme: 'forcing-check',
    sideToMove: 'black',
  },
  {
    fen: '1k6/1b6/8/8/8/8/6PP/2q3K1 b - - 0 1',
    solutionMoves: 'c1e1',
    rating: 750,
    theme: 'mate-in-1',
    sideToMove: 'black',
  },
  {
    fen: '6k1/5ppp/8/8/8/8/Q7/4KR2 w - - 0 1',
    solutionMoves: 'a2f7,g8h8,f7e8',
    rating: 1100,
    theme: 'mate-in-2',
    sideToMove: 'white',
  },
  {
    fen: '4r1k1/8/8/3N4/8/8/6PP/6K1 w - - 0 1',
    solutionMoves: 'd5f6',
    rating: 900,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: 'r1b1kb1r/ppp2ppp/2n5/3qp3/4n3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 2 7',
    solutionMoves: 'c3d5',
    rating: 950,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: 'r2qkbnr/ppp1pppp/2n5/3p1b2/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 4 4',
    solutionMoves: 'f3e5',
    rating: 950,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: '2kr3r/ppp1qppp/2n5/2b1p3/4P1n1/2NP1N2/PPP1BPPP/R1BQ1RK1 b - - 4 9',
    solutionMoves: 'g4f2',
    rating: 1050,
    theme: 'fork',
    sideToMove: 'black',
  },
  {
    fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
    solutionMoves: 'c3d5',
    rating: 1000,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: '3rk3/8/8/3r4/8/8/8/3RK3 w - - 0 1',
    solutionMoves: 'd1d5',
    rating: 900,
    theme: 'discovered-attack',
    sideToMove: 'white',
  },
  {
    fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 4',
    solutionMoves: 'f3f7',
    rating: 950,
    theme: 'mate-in-1',
    sideToMove: 'white',
  },
  {
    fen: '3qk3/8/8/8/8/8/8/3RK3 w - - 0 1',
    solutionMoves: 'd1d8',
    rating: 950,
    theme: 'back-rank-tactic',
    sideToMove: 'white',
  },
  {
    fen: 'r4rk1/ppp2ppp/8/2b1q3/8/2N5/PPP2PPP/R2Q1RK1 w - - 0 1',
    solutionMoves: 'c3d5',
    rating: 1000,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: '6k1/8/8/8/8/8/6PP/q4RK1 w - - 0 1',
    solutionMoves: 'f1a1',
    rating: 900,
    theme: 'back-rank-tactic',
    sideToMove: 'white',
  },
  {
    fen: 'r5k1/8/8/3N4/8/8/6PP/6K1 w - - 0 1',
    solutionMoves: 'd5f6',
    rating: 900,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: '3rr1k1/pp3ppp/8/8/1b6/2N5/PPP2PPP/2KR3R w - - 0 1',
    solutionMoves: 'c3b5',
    rating: 1000,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: 'r1b2rk1/ppp2ppp/2nqbn2/3p4/1P1P4/2N1PN2/P4PPP/R1BQKB1R w KQ - 4 8',
    solutionMoves: 'c3b5',
    rating: 1050,
    theme: 'fork',
    sideToMove: 'white',
  },
  {
    fen: '3k4/8/3K4/8/8/8/8/7R w - - 0 1',
    solutionMoves: 'h1h8',
    rating: 700,
    theme: 'basic-checkmate',
    sideToMove: 'white',
  },
  {
    fen: '6k1/6pp/8/8/8/8/8/Q3KR2 w - - 0 1',
    solutionMoves: 'a1a2,g8h8,a2a8',
    rating: 1000,
    theme: 'mate-in-2',
    sideToMove: 'white',
  },
  {
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solutionMoves: 'f3e5',
    rating: 900,
    theme: 'fork',
    sideToMove: 'white',
  },
];
