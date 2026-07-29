import { useState } from 'react'
import './TicTacToe.css'

function Square({ value, onSquareClick, highlight }) {
  return (
    <button
      className={`square${highlight ? ' highlight' : ''}`}
      onClick={onSquareClick}
    >
      {value}
    </button>
  )
}

function calculateWinner(squares) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]
  for (const [a, b, c] of lines) {
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return { winner: squares[a], line: [a, b, c] }
    }
  }
  return null
}

export default function TicTacToe() {
  const [history, setHistory] = useState([Array(9).fill(null)])
  const [currentMove, setCurrentMove] = useState(0)
  const [isAscending, setIsAscending] = useState(true)

  const currentSquares = history[currentMove]
  const xIsNext = currentMove % 2 === 0
  const result = calculateWinner(currentSquares)

  const winner = result?.winner ?? null
  const winningLine = result?.line ?? []

  const isDraw = !winner && currentSquares.every(Boolean) && history.length === 10

  const moves = history.map((_squares, move) => {
    const desc = move === 0
      ? 'Go to game start'
      : `Go to move #${move}`
    const isCurrent = move === currentMove

    const i = move > 0 ? history[move].findIndex(
      (s, idx) => s !== (history[move - 1]?.[idx] ?? null)
    ) : -1
    const moveRow = i >= 0 ? Math.floor(i / 3) + 1 : 0
    const moveCol = i >= 0 ? (i % 3) + 1 : 0

    return (
      <li key={move}>
        {isCurrent ? (
          <span className="current-move">
            {move === 0 ? 'Game start (current)' : `Move #${move} (r${moveRow}c${moveCol} — current)`}
          </span>
        ) : (
          <button className="move-button" onClick={() => setCurrentMove(move)}>
            {desc}
          </button>
        )}
      </li>
    )
  })

  if (!isAscending) {
    moves.reverse()
  }

  let status
  if (winner) {
    status = `Winner: ${winner}`
  } else if (isDraw) {
    status = 'Draw!'
  } else {
    status = `Next player: ${xIsNext ? 'X' : 'O'}`
  }

  function handleSquareClick(i) {
    if (currentSquares[i] || winner) return

    const nextSquares = currentSquares.slice()
    nextSquares[i] = xIsNext ? 'X' : 'O'

    setHistory([...history.slice(0, currentMove + 1), nextSquares])
    setCurrentMove(currentMove + 1)
  }

  function handleNewGame() {
    setHistory([Array(9).fill(null)])
    setCurrentMove(0)
  }

  return (
    <div className="game">
      <h1 className="game-title">Tic Tac Toe</h1>
      <div className="status">{status}</div>
      <div className="game-board">
        {[0, 1, 2].map((row) => (
          <div className="board-row" key={row}>
            {[0, 1, 2].map((col) => {
              const i = row * 3 + col
              return (
                <Square
                  key={i}
                  value={currentSquares[i]}
                  onSquareClick={() => handleSquareClick(i)}
                  highlight={winningLine.includes(i)}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="game-info">
        <div className="game-info-header">
          <h2>History</h2>
          <button className="sort-button" onClick={() => setIsAscending(!isAscending)}>
            {isAscending ? '▼' : '▲'}
          </button>
        </div>
        <ol className="move-list">{moves}</ol>
        <button className="new-game-button" onClick={handleNewGame}>
          New Game
        </button>
      </div>
    </div>
  )
}
