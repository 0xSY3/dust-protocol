import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XIcon, SendIcon } from 'lucide-react';
interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
}
export function SendModal({ isOpen, onClose }: SendModalProps) {
  return (
    <AnimatePresence>
      {isOpen &&
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
          initial={{
            opacity: 0
          }}
          animate={{
            opacity: 1
          }}
          exit={{
            opacity: 0
          }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          <motion.div
          initial={{
            opacity: 0,
            scale: 0.95,
            y: 20
          }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0
          }}
          exit={{
            opacity: 0,
            scale: 0.95,
            y: 20
          }}
          className="relative w-full max-w-[440px] p-6 rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <SendIcon className="w-4 h-4 text-[#00FF41]" />
                <span className="text-sm font-bold text-white font-mono tracking-wider">
                  [ SEND ]
                </span>
              </div>
              <button
              onClick={onClose}
              className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">

                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                  Recipient
                </label>
                <input
                type="text"
                placeholder=".tok name or meta-address"
                className="w-full p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)]" />

              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                  Amount
                </label>
                <div className="relative">
                  <input
                  type="text"
                  placeholder="0.00"
                  className="w-full p-3 pr-16 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)]" />

                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[rgba(255,255,255,0.5)] font-mono">
                    ETH
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono">
                  Network Fee
                </span>
                <span className="text-[10px] text-[rgba(255,255,255,0.6)] font-mono">
                  ≈ $1.45
                </span>
              </div>
            </div>

            {/* Action */}
            <button className="w-full py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] transition-all group">
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm font-bold text-[#00FF41] font-mono tracking-wider">
                  [ EXECUTE_SEND ]
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
            </button>

            {/* Corner Accents */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)] rounded-tl-sm" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)] rounded-tr-sm" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)] rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)] rounded-br-sm" />
          </motion.div>
        </div>
      }
    </AnimatePresence>);

}