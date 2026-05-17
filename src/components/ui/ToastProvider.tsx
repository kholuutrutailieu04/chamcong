'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextProps {
  toast: (message: string, type?: ToastType) => void;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  toastWarning: (message: string) => void;
}

const ToastContext = createContext<ToastContextProps | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto remove after 3s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const toastSuccess = useCallback((msg: string) => addToast(msg, 'success'), [addToast]);
  const toastError = useCallback((msg: string) => addToast(msg, 'error'), [addToast]);
  const toastWarning = useCallback((msg: string) => addToast(msg, 'warning'), [addToast]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast: addToast, toastSuccess, toastError, toastWarning }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-md min-w-[280px] max-w-sm ${
                t.type === 'success' ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800' :
                t.type === 'error' ? 'bg-red-50/90 border-red-200 text-red-800' :
                t.type === 'warning' ? 'bg-amber-50/90 border-amber-200 text-amber-800' :
                'bg-blue-50/90 border-blue-200 text-blue-800'
              }`}
            >
              {t.type === 'success' && <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />}
              {t.type === 'error' && <AlertCircle size={20} className="text-red-500 shrink-0" />}
              {t.type === 'warning' && <AlertTriangle size={20} className="text-amber-500 shrink-0" />}
              {t.type === 'info' && <Info size={20} className="text-blue-500 shrink-0" />}
              
              <p className="text-sm font-medium leading-tight flex-1">{t.message}</p>
              
              <button 
                onClick={() => removeToast(t.id)}
                className="opacity-50 hover:opacity-100 transition-opacity p-1"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
