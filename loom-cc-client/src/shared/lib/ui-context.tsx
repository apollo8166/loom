'use client'

import { createContext, useContext, useState } from 'react'

interface UIContextValue {
  isFileTreeOpen: boolean
  setIsFileTreeOpen: (open: boolean) => void
}

const UIContext = createContext<UIContextValue>({
  isFileTreeOpen: true,
  setIsFileTreeOpen: () => {},
})

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(true)
  return (
    <UIContext.Provider value={{ isFileTreeOpen, setIsFileTreeOpen }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUIContext() {
  return useContext(UIContext)
}
