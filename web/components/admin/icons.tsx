import {
  Mountain,
  CalendarCheck,
  Route,
  ChartColumn,
  Users,
  LogOut,
  Pencil,
  Archive,
  ArchiveRestore,
  UserX,
  UserCheck,
  UserPlus,
  UserMinus,
  Send,
  ArrowRight,
  Check,
  X,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';

// Mapa de nombres semánticos → íconos de lucide-react.
const ICONS: Record<string, LucideIcon> = {
  tours: Mountain,
  bookings: CalendarCheck,
  departures: Route,
  reports: ChartColumn,
  users: Users,
  logout: LogOut,
  edit: Pencil,
  archive: Archive,
  restore: ArchiveRestore,
  deactivate: UserX,
  reactivate: UserCheck,
  assign: UserPlus,
  unassign: UserMinus,
  resend: Send,
  detail: ArrowRight,
  checkin: Check,
  cancel: X,
  retry: RotateCw,
};

type Props = { name: string; size?: number };

export function Icon({ name, size = 16 }: Props) {
  const LucideGlyph = ICONS[name];
  if (!LucideGlyph) return null;
  return <LucideGlyph size={size} strokeWidth={1.8} aria-hidden />;
}
