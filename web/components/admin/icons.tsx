import {
  CalendarCheck,
  Route,
  ChartColumn,
  Users,
  LogOut,
  Pencil,
  UserX,
  UserCheck,
  UserPlus,
  UserMinus,
  Send,
  ArrowRight,
  Check,
  X,
  RotateCw,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Pause,
  Play,
  type LucideIcon,
} from 'lucide-react';

// Mapa de nombres semánticos → íconos de lucide-react.
const ICONS: Record<string, LucideIcon> = {
  bookings: CalendarCheck,
  departures: Route,
  reports: ChartColumn,
  users: Users,
  logout: LogOut,
  edit: Pencil,
  deactivate: UserX,
  reactivate: UserCheck,
  assign: UserPlus,
  unassign: UserMinus,
  resend: Send,
  detail: ArrowRight,
  checkin: Check,
  cancel: X,
  retry: RotateCw,
  settings: Settings,
  privacy: ShieldCheck,
  'tour-day': Sun,
  'tour-night': Moon,
  pause: Pause,
  resume: Play,
};

type Props = { name: string; size?: number };

export function Icon({ name, size = 16 }: Props) {
  const LucideGlyph = ICONS[name];
  if (!LucideGlyph) return null;
  return <LucideGlyph size={size} strokeWidth={1.8} aria-hidden />;
}
