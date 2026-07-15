interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Product symbol. The internal component name stays stable for clean upstream
 * merges while the rendered mark carries the Trunk brand.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"
        strokeWidth="2"
      />
    </svg>
  )
}
