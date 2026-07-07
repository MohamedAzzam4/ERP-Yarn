/**
 * Sidebar icons — professional outline SVG icons for the demo sidebar.
 *
 * Each icon is a simple inline SVG (no external dependency).
 * Icons support RTL layout (non-directional, so no mirroring needed).
 * All icons use currentColor for fill/stroke so they inherit text color.
 */

interface IconProps {
  className?: string;
  size?: number;
}

function baseProps(size: number = 18) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function DashboardIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

export function CheckIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function ChartIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function BoxesIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.74a2 2 0 0 0 .97 1.71l3 1.83a2 2 0 0 0 2.06 0L12 20l3.97 2.21a2 2 0 0 0 2.06 0l3-1.83A2 2 0 0 0 22 18.37v-3.74a2 2 0 0 0-.97-1.71l-3-1.83a2 2 0 0 0-2.06 0L12 12l-3.97-2.21a2 2 0 0 0-2.06 0l-3 .83z" />
      <path d="M7 17v-4.5" />
      <path d="M12 15v-4.5" />
      <path d="M17 17v-4.5" />
    </svg>
  );
}

export function TrendingIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

export function DatabaseIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

export function UsersIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function DocumentIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

export function BellIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function HistoryIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function EditIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function CartIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

export function ReceiptIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="13" y2="15" />
    </svg>
  );
}

export function FactoryIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <path d="M2 20h20V8l-6 4V8l-6 4V4H4v16z" />
      <path d="M6 16h2" />
      <path d="M11 16h2" />
      <path d="M16 16h2" />
    </svg>
  );
}

export function TransferIcon({ className, size }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden="true">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

// Icon name → component mapping
const ICON_MAP: Record<string, React.FC<IconProps>> = {
  dashboard: DashboardIcon,
  check: CheckIcon,
  chart: ChartIcon,
  boxes: BoxesIcon,
  trending: TrendingIcon,
  database: DatabaseIcon,
  users: UsersIcon,
  document: DocumentIcon,
  bell: BellIcon,
  history: HistoryIcon,
  edit: EditIcon,
  cart: CartIcon,
  receipt: ReceiptIcon,
  factory: FactoryIcon,
  transfer: TransferIcon,
};

export function SidebarIcon({ name, className, size }: { name: string; className?: string; size?: number }) {
  const IconComponent = ICON_MAP[name];
  if (!IconComponent) return null;
  return <IconComponent className={className} size={size} />;
}
