import { createContext, useContext, useState, type ReactNode } from 'react'

export type DisasterMode = 'flood' | 'landslide'

interface DisasterContextValue {
  mode: DisasterMode
  setMode: (m: DisasterMode) => void
}

const DisasterContext = createContext<DisasterContextValue>({
  mode: 'flood',
  setMode: () => {},
})

export function DisasterProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DisasterMode>('flood')
  return (
    <DisasterContext.Provider value={{ mode, setMode }}>
      {children}
    </DisasterContext.Provider>
  )
}

export function useDisasterMode() {
  return useContext(DisasterContext)
}
