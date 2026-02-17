import React from 'react';
import { motion } from 'framer-motion';
interface SwapButtonProps {
  onClick?: () => void;
  disabled?: boolean;
}
export function SwapButton({ onClick, disabled }: SwapButtonProps) {
  return (
    <motion.button
      whileHover={{
        scale: 1.01
      }}
      whileTap={{
        scale: 0.99
      }}
      onClick={onClick}
      disabled={disabled}
      className="group relative w-full py-4 mt-2 overflow-hidden rounded-sm border border-[rgba(0,255,65,0.2)] bg-transparent hover:bg-[rgba(0,255,65,0.08)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed">

      <div className="relative z-10 flex items-center justify-center gap-2">
        <span className="text-sm font-bold tracking-widest text-[rgba(0,255,65,0.8)] group-hover:text-[#00FF41] transition-colors font-mono">
          [ SWAP ]
        </span>
        <motion.span
          animate={{
            opacity: [0, 1, 0]
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            ease: 'linear'
          }}
          className="text-[#00FF41] font-bold">

          _
        </motion.span>
      </div>

      {/* Scanline effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[rgba(0,255,65,0.05)] to-transparent translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 ease-in-out" />
    </motion.button>);

}