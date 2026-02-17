'use client'

import { useState } from 'react'
import { ChevronDownIcon, CheckIcon } from 'lucide-react'
import { formatUnits } from 'viem'
import { type StoredSwapNote } from '@/lib/swap/storage/swap-notes'

interface NoteSelectorProps {
  label: string
  notes: StoredSwapNote[]
  selectedNote: StoredSwapNote | null
  onSelect: (note: StoredSwapNote) => void
}

function formatNoteAmount(amount: bigint, tokenSymbol: string): string {
  // ETH uses 18 decimals, USDC uses 6
  const decimals = tokenSymbol.toUpperCase() === 'USDC' ? 6 : 18
  const formatted = formatUnits(amount, decimals)
  const num = parseFloat(formatted)
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`
  if (num < 0.0001 && num > 0) return num.toExponential(2)
  return num.toFixed(decimals === 6 ? 2 : 4)
}

function truncateCommitment(commitment: bigint): string {
  const hex = commitment.toString(16).padStart(64, '0')
  return `0x${hex.slice(0, 6)}…${hex.slice(-4)}`
}

export function NoteSelector({
  label,
  notes,
  selectedNote,
  onSelect,
}: NoteSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative z-20">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
          {label}
        </span>
        {selectedNote && selectedNote.id !== undefined && (
          <span className="text-[10px] text-[#00FF41] font-mono tracking-wider">
            ID: #{selectedNote.id}
          </span>
        )}
      </div>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-3 rounded-sm border bg-[rgba(255,255,255,0.02)] transition-all duration-300 group ${
          isOpen
            ? 'border-[#00FF41] shadow-[0_0_15px_rgba(0,255,65,0.1)]'
            : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)]'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center border border-[rgba(255,255,255,0.1)] group-hover:border-[#00FF41] transition-colors">
            <span className="text-xs font-bold text-white group-hover:text-[#00FF41]">
              {selectedNote ? selectedNote.tokenSymbol[0] : '?'}
            </span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-white font-mono group-hover:text-[#00FF41] transition-colors">
              {selectedNote
                ? `${formatNoteAmount(selectedNote.amount, selectedNote.tokenSymbol)} ${selectedNote.tokenSymbol}`
                : 'Select a note'}
            </span>
            <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono">
              {selectedNote
                ? truncateCommitment(selectedNote.commitment)
                : 'No note selected'}
            </span>
          </div>
        </div>
        <ChevronDownIcon
          className={`w-4 h-4 text-[rgba(255,255,255,0.4)] transition-transform duration-300 ${
            isOpen ? 'rotate-180 text-[#00FF41]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#06080F] border border-[rgba(255,255,255,0.1)] rounded-sm shadow-2xl overflow-hidden z-30">
          <div className="max-h-48 overflow-y-auto">
            {notes.length === 0 ? (
              <div className="p-3 text-center text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
                No unspent notes available
              </div>
            ) : (
              notes.map((note, idx) => (
                <button
                  key={note.id ?? idx}
                  onClick={() => {
                    onSelect(note)
                    setIsOpen(false)
                  }}
                  className="w-full flex items-center justify-between p-3 hover:bg-[rgba(0,255,65,0.05)] transition-colors border-b border-[rgba(255,255,255,0.03)] last:border-0 group/item"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[rgba(255,255,255,0.03)] flex items-center justify-center text-[10px] text-[rgba(255,255,255,0.5)] group-hover/item:text-[#00FF41] border border-[rgba(255,255,255,0.05)]">
                      {note.tokenSymbol[0]}
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-xs font-bold text-white font-mono group-hover/item:text-[#00FF41]">
                        {formatNoteAmount(note.amount, note.tokenSymbol)}{' '}
                        {note.tokenSymbol}
                      </span>
                      <span className="text-[9px] text-[rgba(255,255,255,0.3)] font-mono">
                        {truncateCommitment(note.commitment)}
                      </span>
                    </div>
                  </div>
                  {selectedNote?.id === note.id && selectedNote?.id !== undefined && (
                    <CheckIcon className="w-3 h-3 text-[#00FF41]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
